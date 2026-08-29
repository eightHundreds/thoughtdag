import { t } from '../i18n';
import { toast } from './ui-store';

export function toastMaterialDesktopHint() {
  toast('info', t('compact.materialDesktopHint'));
}
