import SwiftUI

struct HistoryView: View {
    @ObservedObject var browser: BrowserModel
    let dismiss: () -> Void
    @ObservedObject private var services = AppServices.shared
    @State private var query = ""
    @State private var clearing = false
    @State private var revision = 0

    private struct DayGroup: Identifiable {
        let day: Date
        let items: [HistoryItem]
        var id: Date { day }
    }

    private var groups: [DayGroup] {
        _ = revision
        let calendar = Calendar.current
        let items = Array(services.history.search(query).prefix(500))
        let grouped = Dictionary(grouping: items) { calendar.startOfDay(for: Date(timeIntervalSince1970: $0.visitedAt)) }
        return grouped.keys.sorted(by: >).map { DayGroup(day: $0, items: grouped[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                if groups.isEmpty {
                    Text(query.isEmpty ? "El historial está vacío." : "Ninguna página coincide con la búsqueda.").foregroundColor(.secondary)
                }
                ForEach(groups) { group in
                    Section(dayLabel(group.day)) {
                        ForEach(group.items) { item in
                            Button {
                                browser.navigate(item.url)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(AddressFormat.title(item.url, item.title)).foregroundColor(.primary).lineLimit(1)
                                    Text("\(Date(timeIntervalSince1970: item.visitedAt).formatted(date: .omitted, time: .shortened)) · \(AddressFormat.display(item.url).text)")
                                        .font(.footnote).foregroundColor(.secondary).lineLimit(1)
                                }
                            }
                            .swipeActions {
                                Button("Quitar", role: .destructive) {
                                    services.history.remove(id: item.id)
                                    revision += 1
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $query, prompt: "Buscar en el historial")
            .navigationTitle("Historial")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cerrar", action: dismiss) }
                ToolbarItem(placement: .destructiveAction) { Button("Borrar…", role: .destructive) { clearing = true } }
            }
            .confirmationDialog("Borrar historial", isPresented: $clearing, titleVisibility: .visible) {
                ForEach(ClearRange.allCases, id: \.self) { range in
                    Button(rangeLabel(range), role: .destructive) {
                        services.history.clear(range)
                        revision += 1
                    }
                }
            }
        }
    }

    private func rangeLabel(_ range: ClearRange) -> String {
        switch range {
        case .hour: return "La última hora"
        case .day: return "El último día"
        case .week: return "La última semana"
        case .all: return "Todo el historial"
        }
    }

    private func dayLabel(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Hoy" }
        if calendar.isDateInYesterday(day) { return "Ayer" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "es_ES")
        formatter.dateFormat = "EEEE, d 'de' MMMM 'de' yyyy"
        return formatter.string(from: day)
    }
}

struct DownloadsView: View {
    @ObservedObject private var downloads = AppServices.shared.downloads
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if downloads.items.isEmpty { Text("No hay descargas.").foregroundColor(.secondary) }
                    ForEach(downloads.items) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.name).lineLimit(2)
                                Text(status(item)).font(.footnote).foregroundColor(item.status == .failed ? .red : .secondary)
                                if item.status == .inProgress { ProgressView(value: item.progress) }
                            }
                            Spacer()
                            if item.status == .completed, let url = item.fileURL {
                                ShareLink(item: url) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel("Abrir o compartir \(item.name)")
                            }
                        }
                        .swipeActions {
                            Button("Quitar", role: .destructive) { downloads.remove(item, deleteFile: false) }
                            if item.fileURL != nil {
                                Button("Borrar archivo", role: .destructive) { downloads.remove(item, deleteFile: true) }
                            }
                        }
                    }
                } footer: {
                    Text("Los archivos se guardan en Archivos → En mi iPhone → ICARUS → Descargas.")
                }
            }
            .navigationTitle("Descargas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } } }
        }
    }

    private func status(_ item: DownloadsStore.Item) -> String {
        switch item.status {
        case .inProgress: return "Descargando… \(Int(item.progress * 100)) %"
        case .completed: return "Completada · \(item.startedAt.formatted(date: .abbreviated, time: .shortened))"
        case .failed: return "Error: \(item.error ?? "desconocido")"
        case .cancelled: return "Cancelada"
        }
    }
}
