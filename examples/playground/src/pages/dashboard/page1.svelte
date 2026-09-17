<script lang="ts">
  import DashboardLayout from "./layout.svelte";
</script>

<DashboardLayout
  title="Page 1"
  description="A dashboard sub-route using the same protected client."
>
  <section class="bg-base-100 shadow-sm card-border card">
    <div class="gap-5 card-body">
      <span class="badge badge-ghost">/dashboard/page1</span>
      <h2 class="text-2xl card-title">Page 1 content</h2>
      <p class="max-w-2xl text-base-content/70 leading-7">
        New pages in the authenticated area can be added here without
        importing the site or auth client.
      </p>
      <div class="card-actions">
        <a class="btn" href="/dashboard">Back to overview</a>
      </div>
    </div>
  </section>
</DashboardLayout>
