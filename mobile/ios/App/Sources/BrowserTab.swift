import SwiftUI
import WebKit

/// Error que ocupa la pestaña en lugar de la página.
struct PageError: Equatable {
    enum Kind { case certificate, network, crashed }
    let kind: Kind
    let url: String
    let detail: String
}

/// Petición que la pestaña necesita que la interfaz resuelva (diálogo, permiso…).
enum TabRequest: Identifiable {
    case alert(message: String, host: String, done: () -> Void)
    case confirm(message: String, host: String, done: (Bool) -> Void)
    case prompt(message: String, host: String, defaultText: String, done: (String?) -> Void)
    case auth(host: String, realm: String, insecure: Bool, done: (URLCredential?) -> Void)
    /// nil = se cerró sin decidir (no se recuerda).
    case permission(origin: String, names: String, done: (Bool?) -> Void)
    case download(name: String, host: String, done: (Bool) -> Void)
    case external(url: URL, done: (Bool) -> Void)

    var id: String {
        switch self {
        case .alert: return "alert"
        case .confirm: return "confirm"
        case .prompt: return "prompt"
        case .auth: return "auth"
        case .permission: return "permission"
        case .download: return "download"
        case .external: return "external"
        }
    }

    /// Respuesta segura cuando no se puede preguntar (otra petición abierta o pestaña cerrada).
    func resolveWithDefault() {
        switch self {
        case .alert(_, _, let done): done()
        case .confirm(_, _, let done): done(false)
        case .prompt(_, _, _, let done): done(nil)
        case .auth(_, _, _, let done): done(nil)
        case .permission(_, _, let done): done(nil)
        case .download(_, _, let done): done(false)
        case .external(_, let done): done(false)
        }
    }
}

/// Una pestaña: su WKWebView (creado al abrir la primera página) y su estado.
///
/// Todas las pestañas usan el mismo almacén de datos de WebKit: cookies, almacenamiento
/// y caché son comunes a todas (no están aisladas entre sí).
@MainActor
final class BrowserTab: NSObject, ObservableObject, Identifiable, WKNavigationDelegate, WKUIDelegate {
    let id = UUID()
    private let services = AppServices.shared
    weak var browser: BrowserModel?

    @Published private(set) var webView: WKWebView?
    /// Dirección real de la página actual.
    @Published private(set) var url: String = InternalPage.newTab.url
    @Published private(set) var title = ""
    @Published private(set) var progress = 1.0
    @Published private(set) var loading = false
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false
    @Published private(set) var showingNewTab = true
    @Published var error: PageError?
    /// Petición visible. WebKit exige responder a todas: usar `present`.
    @Published var request: TabRequest?

    private var pendingURL: String?
    private var observations: [NSKeyValueObservation] = []
    private var lastMainFrameURL: String?

    init(url: String? = nil) {
        super.init()
        if let url, url != InternalPage.newTab.url {
            pendingURL = url
            self.url = url
            showingNewTab = false
        }
    }

    /// Carga pendiente de una pestaña restaurada (se crea el WKWebView al mostrarla).
    func activate() {
        if let pending = pendingURL {
            pendingURL = nil
            load(pending)
        }
    }

    func load(_ target: String) {
        guard let destination = URL(string: target) else { return }
        let view = ensureWebView()
        showingNewTab = false
        error = nil
        url = target
        applyShield(for: target, in: view)
        view.load(URLRequest(url: destination))
    }

    func showNewTab() {
        webView?.stopLoading()
        pendingURL = nil
        showingNewTab = true
        error = nil
        loading = false
        url = InternalPage.newTab.url
        title = ""
        updateNavigationState()
    }

    func goBack() {
        if showingNewTab, let view = webView {
            showingNewTab = false
            url = view.url?.absoluteString ?? url
            title = view.title ?? ""
            updateNavigationState()
        } else if error != nil, webView?.canGoBack == true {
            error = nil
            webView?.goBack()
        } else {
            webView?.goBack()
        }
    }

    func goForward() { webView?.goForward() }

    func reload() {
        if let failed = error {
            error = nil
            load(failed.url)
        } else {
            webView?.reload()
        }
    }

    func stop() { webView?.stopLoading() }

    func leaveError() {
        if let view = webView, view.canGoBack {
            error = nil
            view.goBack()
        } else {
            showNewTab()
        }
    }

    /// Muestra una petición; si ya hay otra abierta, la nueva recibe la respuesta segura.
    func present(_ new: TabRequest) {
        if request == nil { request = new } else { new.resolveWithDefault() }
    }

    func close() {
        request?.resolveWithDefault()
        request = nil
        webView?.stopLoading()
        observations.removeAll()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView = nil
    }

    /// WKWebView para una ventana nueva (target=_blank / window.open) con la configuración de WebKit.
    func adopt(configuration: WKWebViewConfiguration) -> WKWebView {
        showingNewTab = false
        pendingURL = nil
        url = "about:blank"
        return makeWebView(configuration: configuration)
    }

    @discardableResult
    func ensureWebView() -> WKWebView {
        if let webView { return webView }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        return makeWebView(configuration: configuration)
    }

    private func makeWebView(configuration: WKWebViewConfiguration) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.isFindInteractionEnabled = true
        if #available(iOS 16.4, *) { view.isInspectable = false }
        observations = [
            view.observe(\.title) { [weak self] view, _ in Task { @MainActor in self?.titleChanged(view.title ?? "") } },
            view.observe(\.url) { [weak self] view, _ in Task { @MainActor in self?.urlChanged(view.url) } },
            view.observe(\.estimatedProgress) { [weak self] view, _ in
                let value = view.estimatedProgress
                Task { @MainActor in self?.progress = value }
            },
            view.observe(\.isLoading) { [weak self] view, _ in
                let value = view.isLoading
                Task { @MainActor in
                    self?.loading = value
                    self?.updateNavigationState()
                }
            },
        ]
        webView = view
        return view
    }

    private func titleChanged(_ value: String) {
        title = value
        if !showingNewTab { services.history.updateTitle(url: url, title: value) }
    }

    private func urlChanged(_ value: URL?) {
        guard let value, !showingNewTab, error == nil else { return }
        url = value.absoluteString
        updateNavigationState()
    }

    private func updateNavigationState() {
        canGoBack = (showingNewTab && webView != nil) || (!showingNewTab && webView?.canGoBack == true)
        canGoForward = webView?.canGoForward == true
    }

    /// Añade o quita las reglas de Shield antes de cargar la página (excepciones por sitio).
    private func applyShield(for pageURL: String, in view: WKWebView) {
        let controller = view.configuration.userContentController
        controller.removeAllContentRuleLists()
        if services.shield.enabled, !services.shield.isSiteAllowed(pageURL), let rules = services.shieldRules {
            controller.add(rules)
        }
    }

    var isShieldActive: Bool {
        services.shield.enabled && services.shieldRules != nil && (showingNewTab || !services.shield.isSiteAllowed(url))
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        guard let target = navigationAction.request.url else { return decisionHandler(.cancel, preferences) }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if navigationAction.shouldPerformDownload { return decisionHandler(.download, preferences) }
        switch target.scheme?.lowercased() {
        // Los enlaces de las páginas van a su URL real: las direcciones personalizadas
        // solo se resuelven cuando el usuario las escribe en la barra.
        case "http", "https":
            if mainFrame {
                lastMainFrameURL = target.absoluteString
                applyShield(for: target.absoluteString, in: webView)
            }
            decisionHandler(.allow, preferences)
        case "about", "blob", "data":
            // data: y blob: solo en marcos internos o recursos; nunca como página principal.
            decisionHandler(mainFrame && target.scheme?.lowercased() != "about" ? .cancel : .allow, preferences)
        case "javascript", "file", "icarus", "vbscript", nil:
            decisionHandler(.cancel, preferences)
        default:
            decisionHandler(.cancel, preferences)
            // Otras apps solo se abren si el usuario pulsó un enlace y lo confirma.
            if mainFrame && navigationAction.navigationType == .linkActivated {
                present(.external(url: target) { open in
                    if open { UIApplication.shared.open(target) }
                })
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let attachment = disposition.lowercased().hasPrefix("attachment")
        guard navigationResponse.isForMainFrame, attachment || !navigationResponse.canShowMIMEType else { return decisionHandler(.allow) }
        let name = navigationResponse.response.suggestedFilename ?? "descarga"
        let host = navigationResponse.response.url?.host ?? ""
        present(.download(name: name, host: host) { accepted in decisionHandler(accepted ? .download : .cancel) })
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        services.downloads.track(download, name: navigationAction.request.url?.lastPathComponent ?? "descarga")
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        services.downloads.track(download, name: navigationResponse.response.suggestedFilename ?? "descarga")
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if !showingNewTab, let current = webView.url?.absoluteString, current != error?.url { error = nil }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard !showingNewTab, let current = webView.url?.absoluteString else { return }
        url = current
        if services.settings.saveHistory { services.history.add(url: current, title: webView.title ?? "") }
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateNavigationState()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    private func fail(_ failure: Error) {
        let nsError = failure as NSError
        // Navegación cancelada por otra, o convertida en descarga: no es un error.
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && (nsError.code == 102 || nsError.code == 204) { return }
        let failedURL = (nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? lastMainFrameURL ?? url
        let certificateCodes: Set<Int> = [NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot,
                                          NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected, NSURLErrorSecureConnectionFailed]
        if nsError.domain == NSURLErrorDomain && certificateCodes.contains(nsError.code) {
            error = PageError(kind: .certificate, url: failedURL, detail: BrowserTab.describeCertificate(nsError.code))
        } else {
            error = PageError(kind: .network, url: failedURL, detail: BrowserTab.describeNetwork(nsError))
        }
        url = failedURL
        loading = false
    }

    /// Si el proceso de la página falla, solo se pierde esta pestaña.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        error = PageError(kind: .crashed, url: url, detail: "El proceso de la página se cerró (iOS puede hacerlo para liberar memoria).")
    }

    /// Autenticación HTTP: se pregunta al usuario. Los certificados los valida WebKit (nunca se omiten).
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        let method = challenge.protectionSpace.authenticationMethod
        guard [NSURLAuthenticationMethodHTTPBasic, NSURLAuthenticationMethodHTTPDigest, NSURLAuthenticationMethodNTLM].contains(method) else {
            return completionHandler(.performDefaultHandling, nil)
        }
        if challenge.previousFailureCount > 2 { return completionHandler(.cancelAuthenticationChallenge, nil) }
        let space = challenge.protectionSpace
        present(.auth(host: space.host, realm: String((space.realm ?? "").prefix(150)), insecure: !space.receivesCredentialSecurely) { credential in
            if let credential { completionHandler(.useCredential, credential) } else { completionHandler(.cancelAuthenticationChallenge, nil) }
        })
    }

    // MARK: WKUIDelegate

    /// Solo se abren ventanas nuevas en respuesta a un gesto (WebKit bloquea el resto).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        browser?.openWindow(from: self, configuration: configuration)
    }

    func webViewDidClose(_ webView: WKWebView) {
        browser?.close(self)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        present(.alert(message: message, host: frame.securityOrigin.host, done: completionHandler))
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        present(.confirm(message: message, host: frame.securityOrigin.host, done: completionHandler))
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        present(.prompt(message: prompt, host: frame.securityOrigin.host, defaultText: defaultText ?? "", done: completionHandler))
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let site = origin.port == 0 ? "\(origin.protocol)://\(origin.host)" : "\(origin.protocol)://\(origin.host):\(origin.port)"
        let wanted: [SitePermission]
        switch type {
        case .camera: wanted = [.camera]
        case .microphone: wanted = [.microphone]
        default: wanted = [.camera, .microphone]
        }
        let decisions = wanted.map { services.profile.permission(origin: site, $0) }
        if decisions.contains(false) { return decisionHandler(.deny) }
        if decisions.allSatisfy({ $0 == true }) { return decisionHandler(.grant) }
        let names = wanted.map { $0 == .camera ? "la cámara" : "el micrófono" }.joined(separator: " y ")
        present(.permission(origin: site, names: names) { [services] allowed in
            if let allowed {
                for permission in wanted { services.profile.setPermission(origin: site, permission, allowed: allowed) }
            }
            decisionHandler(allowed == true ? .grant : .deny)
        })
    }

    // MARK: Textos

    static func describeCertificate(_ code: Int) -> String {
        switch code {
        case NSURLErrorServerCertificateHasBadDate: return "El certificado ha caducado o aún no es válido. Comprueba la fecha del dispositivo."
        case NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot: return "El certificado no lo emite una autoridad de confianza."
        case NSURLErrorServerCertificateNotYetValid: return "El certificado aún no es válido."
        default: return "No se pudo establecer una conexión segura con el sitio."
        }
    }

    static func describeNetwork(_ error: NSError) -> String {
        guard error.domain == NSURLErrorDomain else { return error.localizedDescription }
        switch error.code {
        case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: return "No se encontró el servidor. Comprueba la dirección y la conexión a Internet."
        case NSURLErrorNotConnectedToInternet: return "No hay conexión a Internet."
        case NSURLErrorTimedOut: return "El servidor tardó demasiado en responder."
        case NSURLErrorCannotConnectToHost: return "No se pudo conectar con el servidor."
        case NSURLErrorAppTransportSecurityRequiresSecureConnection: return "iOS no permite esta conexión sin cifrar."
        default: return error.localizedDescription
        }
    }
}
