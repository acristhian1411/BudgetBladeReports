<script>
  import { apiPostMultipart, apiGet } from '$lib/api';
  import { syncStore } from '$lib/stores';

  let file = null;
  let password = '';
  let uploadInProgress = false;

  async function handleSync() {
    if (!file || !password) {
      $syncStore.error = 'File and password are required';
      return;
    }

    uploadInProgress = true;
    syncStore.update(s => ({
      ...s,
      isSyncing: true,
      progress: 0,
      logs: ['Starting backup import...'],
      error: null,
    }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);

      syncStore.update(s => ({
        ...s,
        logs: [...s.logs, '📤 Uploading encrypted backup...'],
      }));

      const result = await apiPostMultipart('/sync/import', formData);

      syncStore.update(s => ({
        ...s,
        logs: [
          ...s.logs,
          '✓ Upload successful',
          `✓ ${Object.values(result.rowCountByTable || {}).reduce((a, b) => a + b, 0)} rows imported`,
          '✓ Backup imported successfully!',
        ],
        progress: 100,
      }));

      // Reset form after 2 seconds
      setTimeout(() => {
        file = null;
        password = '';
        uploadInProgress = false;
        syncStore.update(s => ({ ...s, isSyncing: false }));
      }, 2000);
    } catch (error) {
      syncStore.update(s => ({
        ...s,
        logs: [...s.logs, `✗ Error: ${error.message}`],
        error: error.message,
      }));
      uploadInProgress = false;
    }
  }
</script>

<div class="p-8 space-y-6">
  <div>
    <h1 class="text-4xl font-bold">Data Synchronization</h1>
    <p class="text-brand-surface-2 mt-2">Import your encrypted backup from the mobile app</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Import Section -->
    <div class="lg:col-span-2 card">
      <h2 class="text-xl font-bold mb-6">Import Encrypted Backup</h2>

      <div class="space-y-4">
        <!-- File Input -->
        <div>
          <label class="block text-sm font-medium mb-2" for="file">
            Select .nbb File
          </label>
          <input
            type="file"
            id="file"
            accept=".nbb"
            disabled={uploadInProgress}
            on:change={(e) => (file = e.target.files?.[0] || null)}
            class="w-full px-4 py-2 bg-brand-surface-2 border border-brand-surface-2 rounded cursor-pointer hover:bg-brand-surface-1 transition-colors"
          />
          {#if file}
            <p class="text-xs text-brand-cyan mt-2">✓ {file.name}</p>
          {/if}
        </div>

        <!-- Password Input -->
        <div>
          <label class="block text-sm font-medium mb-2" for="password">
            Backup Password
          </label>
          <input
            type="password"
            id="password"
            bind:value={password}
            disabled={uploadInProgress}
            placeholder="Enter the password used to create the backup"
            class="input-field"
          />
        </div>

        <!-- Submit Button -->
        <button
          on:click={handleSync}
          disabled={!file || !password || uploadInProgress}
          class="button-primary w-full"
        >
          {uploadInProgress ? 'Importing...' : 'Start Synchronization'}
        </button>
      </div>

      <!-- Info -->
      <div class="mt-6 p-4 bg-brand-surface-2 rounded text-sm text-brand-surface-2">
        <p class="mb-2">
          <strong>How to export from the mobile app:</strong>
        </p>
        <ol class="list-decimal list-inside space-y-1 text-xs">
          <li>Open Settings → Data Export</li>
          <li>Choose "Encrypted Backup (.nbb)"</li>
          <li>Set a strong password</li>
          <li>Share or download the .nbb file</li>
          <li>Use the password here to import</li>
        </ol>
      </div>
    </div>

    <!-- Status Panel -->
    <div class="card">
      <h2 class="text-xl font-bold mb-4">Import Status</h2>

      {#if $syncStore.logs.length > 0}
        <div class="bg-brand-surface-2 rounded p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-1">
          {#each $syncStore.logs as log}
            <div class="text-brand-cyan">{log}</div>
          {/each}
        </div>
      {:else}
        <div class="text-center py-8 text-brand-surface-2">
          <p>Waiting for backup upload...</p>
        </div>
      {/if}

      {#if $syncStore.error}
        <div class="mt-4 p-3 bg-brand-rose/20 border border-brand-rose rounded text-brand-rose text-sm">
          {$syncStore.error}
        </div>
      {/if}
    </div>
  </div>
</div>
