import { useMessages } from '../../i18n';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const m = useMessages();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      size="sm"
      role="alertdialog"
      description={message}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} data-autofocus>
            {cancelLabel ?? m.common.cancel}
          </button>
          <button type="button" className={danger ? 'btn btn--danger' : 'btn btn--primary'} onClick={onConfirm}>
            {confirmLabel ?? m.common.confirm}
          </button>
        </>
      }
    >
      {null}
    </Modal>
  );
}
