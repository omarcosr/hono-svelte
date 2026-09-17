<script lang="ts">
  import DashboardLayout from "./layout.svelte";
</script>

<DashboardLayout
  title="Purchase"
  description="A business sub-route inside the authenticated area."
>
  <section class="bg-base-100 shadow-sm card-border card">
    <div class="gap-5 card-body">
      <span class="badge badge-ghost">/dashboard/purchase</span>
      <h2 class="text-2xl card-title">Pick your next step</h2>
      <p class="max-w-2xl text-base-content/70 leading-7">
        This page is just an example of a protected route. The dashboard
        bundle stays the same and the server guards each URL.
      </p>
      <div class="card-actions">
        <button class="btn" type="button">Continue purchase</button>
      </div>
    </div>
  </section>
</DashboardLayout>
