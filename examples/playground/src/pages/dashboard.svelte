<script lang="ts">
  import { hc } from "hono/client";
  import type { AppType } from "../routes";
  import DashboardLayout from "./dashboard/layout.svelte";

  type PageData = { demo?: boolean };
  let { demo }: PageData = $props();

  const client = hc<AppType>("/");

  let count = $state(0);

  let response = $state<string | null>(null);
  let error = $state<string | null>(null);
  let isLoading = $state(false);

  async function handleClockClick() {
    isLoading = true;
    error = null;

    try {
      const res = await client.api.clock.$get();
      const data = await res.json();

      if (!res.ok) {
        error = "The server did not accept the session.";
        response = null;
        return;
      }

      const headers: Record<string, string> = {};
      for (const [key, value] of res.headers.entries()) {
        headers[key] = value;
      }
      const fullResponse = {
        url: res.url,
        status: res.status,
        headers,
        body: data,
      };
      response = JSON.stringify(fullResponse, null, 2);
    } catch {
      error = "Could not reach the server right now.";
      response = null;
    } finally {
      isLoading = false;
    }
  }
</script>

<DashboardLayout
  title="Your space is ready."
  description="The session is active. Use the examples below to try client-side state and an authenticated call to the server."
>
  <div class="gap-6 grid lg:grid-cols-2">
    <section class="bg-base-100 shadow-sm card-border card">
      <div class="gap-6 card-body">
        <div class="flex justify-between items-start gap-4">
          <div>
            <p class="font-medium text-sm text-base-content/60 uppercase tracking-[0.2em]">
              Local state
            </p>
            <h2 class="mt-2 text-2xl card-title">Counter</h2>
          </div>
          <span class="badge badge-ghost">$state</span>
        </div>

        <div class="flex sm:flex-row flex-col sm:justify-between sm:items-end gap-6">
          <div>
            <p class="font-semibold tabular-nums text-6xl">{count}</p>
            <p class="mt-2 text-base-content/60">
              {count === 1 ? "click" : "clicks"} this session
            </p>
          </div>
          <button
            class="self-start sm:self-auto btn"
            type="button"
            onclick={() => (count += 1)}
          >
            Increment
          </button>
        </div>
      </div>
    </section>

    <section class="bg-base-100 shadow-sm card-border card">
      <div class="gap-6 card-body">
        <div class="flex justify-between items-start gap-4">
          <div>
            <p class="font-medium text-sm text-base-content/60 uppercase tracking-[0.2em]">
              Authenticated API
            </p>
            <h2 class="mt-2 text-2xl card-title">Server time</h2>
          </div>
          <span class="badge badge-ghost">GET /api/clock</span>
        </div>

{#if demo}
        <div class="badge badge-info">Server data via page-data</div>
        {/if}
        <p class="text-base-content/70">
          Query the current time through Hono's RPC client and see the full
          response.
        </p>

        <div class="card-actions">
          <button
            class="btn"
            type="button"
            disabled={isLoading}
            aria-busy={isLoading}
            onclick={handleClockClick}
          >
            {isLoading ? "Fetching..." : "Fetch time"}
          </button>
        </div>

        {#if error}
          <div role="alert" class="alert alert-error">
            {error}
          </div>
        {/if}

        {#if response}
          <div role="status" class="alert alert-success alert-vertical sm:alert-horizontal">
            <div class="w-full">
              <p class="font-semibold">Response received</p>
              <pre class="bg-neutral mt-3 p-4 rounded-box max-h-72 overflow-auto text-neutral-content text-xs leading-6">
                {response}
              </pre>
            </div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</DashboardLayout>

