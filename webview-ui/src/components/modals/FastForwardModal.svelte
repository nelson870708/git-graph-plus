<script lang="ts">
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';

  interface Props {
    localBranch: string;
    remote: string;
    onClose: () => void;
    onConfirm: () => void;
  }

  let { localBranch, remote, onClose, onConfirm }: Props = $props();
</script>

<Modal title={t('fastForward.title')} {onClose}>
  <p class="modal-desc">{t('fastForward.desc')}</p>
  <div class="modal-context-card">
    <span class="modal-label">{t('fastForward.switchTo')}</span>
    <span use:tooltip={localBranch} class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{localBranch}</span></span>
  </div>
  <div class="modal-context-card">
    <span class="modal-label">{t('fastForward.fastForwardTo')}</span>
    <span use:tooltip={remote} class="modal-pill modal-pill--target"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{remote}</span></span>
  </div>
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={onConfirm}>{t('fastForward.title')}</button>
  </div>
</Modal>
