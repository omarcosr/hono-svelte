<script lang="ts">
  import { onMount } from "svelte";

  let hasError = $state(false);

  onMount(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    hasError = error === "invalid" || error === "missing";
  });
</script>

<main class="bg-base-200 px-4 sm:px-6 py-8 min-h-dvh">
  <div class="items-center gap-8 grid lg:grid-cols-[1.1fr_0.9fr] mx-auto max-w-6xl min-h-[calc(100dvh-4rem)]">
    <section class="py-8 lg:py-12 max-w-xl">
      <span class="badge-outline badge">Hono + Vite</span>
      <h1 class="mt-6 font-semibold text-4xl sm:text-5xl tracking-tight">
        A small area to test ideas safely.
      </h1>
      <p class="mt-5 max-w-lg text-base-content/70 text-lg leading-8">
        Sign in to open a protected space and try client-side state with a
        typed API on the server.
      </p>
      <div class="flex flex-wrap gap-2 mt-8 text-sm text-base-content/60">
        <span class="badge badge-ghost">HttpOnly session</span>
        <span class="badge badge-ghost">Protected API</span>
      </div>
    </section>

    <section class="bg-base-100 shadow-sm card-border card">
      <div class="gap-6 card-body">
        <div>
          <p class="font-medium text-sm text-base-content/60 uppercase tracking-[0.2em]">
            Access
          </p>
          <h2 class="mt-2 text-2xl card-title">Sign in to the demo</h2>
          <p class="mt-2 text-base-content/70">
            Fill in both fields to create a temporary session.
          </p>
        </div>

        {#if hasError}
          <div role="alert" class="alert alert-error">
            Enter a valid email and a password to continue.
          </div>
        {/if}

        <form action="/auth/login" method="post" class="space-y-5">
          <div class="space-y-2">
            <label for="email" class="block font-medium text-sm">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              class="w-full input"
              required
            />
          </div>

          <div class="space-y-2">
            <label for="password" class="block font-medium text-sm">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="Your password"
              class="w-full input"
              required
            />
          </div>

          <button class="w-full btn" type="submit">Sign in</button>
        </form>

        <p class="text-xs text-base-content/60 leading-5">
          This is a demo login. Any filled email and password create a local
          session for one hour.
        </p>
      </div>
    </section>
  </div>
</main>
