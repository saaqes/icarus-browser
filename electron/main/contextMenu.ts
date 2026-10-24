/** Menú contextual de las páginas web. */

import { clipboard, Menu, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron';
import { STRINGS } from './strings';
import { parseNavigableUrl } from './urlPolicy';

export interface ContextMenuActions {
  openInNewTab: (url: string) => void;
  searchInNewTab: (text: string) => void;
}

export function showPageContextMenu(window: BrowserWindow, contents: WebContents, params: ContextMenuParams, actions: ContextMenuActions): void {
  const t = STRINGS.contextMenu;
  const items: MenuItemConstructorOptions[] = [];
  const link = parseNavigableUrl(params.linkURL);
  const image = params.mediaType === 'image' ? parseNavigableUrl(params.srcURL) : null;
  const selection = params.selectionText.trim();

  if (link) {
    items.push(
      { label: t.openLinkInNewTab, click: () => actions.openInNewTab(link.href) },
      { label: t.copyLinkAddress, click: () => clipboard.writeText(link.href) },
      { type: 'separator' },
    );
  }
  if (image) {
    items.push(
      { label: t.openImageInNewTab, click: () => actions.openInNewTab(image.href) },
      { label: t.saveImageAs, click: () => contents.downloadURL(image.href) },
      { label: t.copyImage, click: () => contents.copyImageAt(params.x, params.y) },
      { label: t.copyImageAddress, click: () => clipboard.writeText(image.href) },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push(
      { label: t.undo, role: 'undo', enabled: params.editFlags.canUndo },
      { label: t.redo, role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: t.cut, role: 'cut', enabled: params.editFlags.canCut },
      { label: t.copy, role: 'copy', enabled: params.editFlags.canCopy },
      { label: t.paste, role: 'paste', enabled: params.editFlags.canPaste },
      { label: t.selectAll, role: 'selectAll', enabled: params.editFlags.canSelectAll },
      { type: 'separator' },
    );
  } else if (selection) {
    items.push(
      { label: t.copy, role: 'copy' },
      { label: t.searchFor(selection), click: () => actions.searchInNewTab(selection.slice(0, 500)) },
      { type: 'separator' },
    );
  }
  if (!link && !image && !selection && !params.isEditable) {
    items.push(
      { label: t.back, enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: t.forward, enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { label: t.reload, click: () => contents.reload() },
      { type: 'separator' },
    );
  }
  items.push({ label: t.inspect, click: () => contents.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(items).popup({ window });
}
