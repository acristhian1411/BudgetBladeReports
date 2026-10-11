<script>
  export let items = [];
  export let itemKey = (item) => item.id;
</script>

<div class="hidden sm:block overflow-x-auto">
  <table class="w-full text-sm">
    <thead class="border-b border-brand-surface-2">
      <tr>
        <slot name="header" />
      </tr>
    </thead>
    <tbody class="divide-y divide-brand-surface-2">
      {#each items as item (itemKey(item))}
        <tr class="hover:bg-brand-surface-2 transition-colors">
          <slot name="row" {item} />
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<div class="sm:hidden space-y-3">
  {#each items as item (itemKey(item))}
    <div class="rounded-lg border border-brand-surface-2 p-4">
      <slot name="card" {item} />
    </div>
  {/each}
</div>
