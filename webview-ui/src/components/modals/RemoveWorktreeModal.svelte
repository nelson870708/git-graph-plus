<script lang="ts">
  import Modal from '../common/Modal.svelte';
  import { t } from '../../lib/i18n/index.svelte';

  interface Props {
    path: string;
    branch: string;
    onClose: () => void;
    onRemove: (deleteBranch: boolean) => void;
  }

  let { path, branch, onClose, onRemove }: Props = $props();
  let deleteBranch = $state(false);
</script>

<Modal title={t('worktree.removeTitle')} {onClose}>
  <p class="modal-desc">{t('worktree.removeConfirm', { path })}</p>
  {#if branch}
    <div class="modal-form-group">
      <label class="modal-checkbox modal-checkbox--danger">
        <input type="checkbox" bind:checked={deleteBranch} />
        <span>{t('worktree.deleteBranch', { name: branch })}</span>
      </label>
    </div>
  {/if}
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="danger-btn" onclick={() => onRemove(deleteBranch)}>{t('sidebar.delete')}</button>
  </div>
</Modal>
