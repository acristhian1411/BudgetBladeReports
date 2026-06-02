<script>
  import { apiPostMultipart, apiGet } from "$lib/api";
  import { syncStore } from "$lib/stores";

  let file = null;
  let password = "";
  let uploadInProgress = false;

  async function handleSync() {
    if (!file || !password) {
      $syncStore.error = "El archivo y la contrasena son obligatorios";
      return;
    }

    uploadInProgress = true;
    syncStore.update((s) => ({
      ...s,
      isSyncing: true,
      progress: 0,
      logs: ["Iniciando importacion del respaldo..."],
      error: null,
    }));

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("password", password);

      syncStore.update((s) => ({
        ...s,
        logs: [...s.logs, "📤 Subiendo respaldo encriptado..."],
      }));

      const result = await apiPostMultipart("/sync/import", formData);

      syncStore.update((s) => ({
        ...s,
        logs: [
          ...s.logs,
          "✓ Carga completada",
          `✓ ${Object.values(result.rowCountByTable || {}).reduce((a, b) => a + b, 0)} filas importadas`,
          "✓ Respaldo importado correctamente",
        ],
        progress: 100,
      }));

      // Reset form after 2 seconds
      setTimeout(() => {
        file = null;
        password = "";
        uploadInProgress = false;
        syncStore.update((s) => ({ ...s, isSyncing: false }));
      }, 2000);
    } catch (error) {
      syncStore.update((s) => ({
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
    <h1 class="text-4xl font-bold">Sincronizacion de datos</h1>
    <p class="text-brand-surface-2 mt-2">
      Importa tu respaldo encriptado desde la app movil
    </p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Import Section -->
    <div class="lg:col-span-2 card">
      <h2 class="text-xl font-bold mb-6">Importar respaldo encriptado</h2>

      <div class="space-y-4">
        <!-- File Input -->
        <div>
          <label class="block text-sm font-medium mb-2" for="file">
            Seleccionar archivo .nbb
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
            Contrasena del respaldo
          </label>
          <input
            type="password"
            id="password"
            bind:value={password}
            disabled={uploadInProgress}
            placeholder="Ingresa la contrasena usada para crear el respaldo"
            class="input-field"
          />
        </div>

        <!-- Submit Button -->
        <button
          on:click={handleSync}
          disabled={!file || !password || uploadInProgress}
          class="button-primary w-full"
        >
          {uploadInProgress ? "Importando..." : "Iniciar sincronizacion"}
        </button>
      </div>

      <!-- Info -->
      <div
        class="mt-6 p-4 bg-brand-surface-2 rounded text-sm text-brand-surface-2"
      >
        <p class="mb-2">
          <strong>Como exportar desde la app movil:</strong>
        </p>
        <ol class="list-decimal list-inside space-y-1 text-xs">
          <li>Abre Configuracion → Exportacion de datos</li>
          <li>Elige "Respaldo encriptado (.nbb)"</li>
          <li>Define una contrasena segura</li>
          <li>Comparte o descarga el archivo .nbb</li>
          <li>Usa aqui la contrasena para importar</li>
        </ol>
      </div>
    </div>

    <!-- Status Panel -->
    <div class="card">
      <h2 class="text-xl font-bold mb-4">Estado de importacion</h2>

      {#if $syncStore.logs.length > 0}
        <div
          class="bg-brand-surface-2 rounded p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-1"
        >
          {#each $syncStore.logs as log}
            <div class="text-brand-cyan">{log}</div>
          {/each}
        </div>
      {:else}
        <div class="text-center py-8 text-brand-surface-2">
          <p>Esperando carga del respaldo...</p>
        </div>
      {/if}

      {#if $syncStore.error}
        <div
          class="mt-4 p-3 bg-brand-rose/20 border border-brand-rose rounded text-brand-rose text-sm"
        >
          {$syncStore.error}
        </div>
      {/if}
    </div>
  </div>
</div>
