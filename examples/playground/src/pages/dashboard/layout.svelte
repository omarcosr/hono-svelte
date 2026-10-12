<script lang="ts">
  import type { Snippet } from "svelte";
  import { getPage } from "hono-svelte/page";

  type Props = {
    title?: string;
    description?: string;
    children: Snippet;
  };

  let { title = "Dashboard", description = "", children }: Props = $props();

  // Active link from the Hono route that rendered the page.
  const page = getPage();
  const links = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/page1", label: "Page 1" },
    { href: "/dashboard/purchase", label: "Purchase" },
  ];
</script>

<main class="bg-base-200 px-4 sm:px-6 py-8 lg:py-12 min-h-dvh">
  <div class="flex flex-col gap-8 mx-auto max-w-6xl">
    <header class="flex lg:flex-row flex-col lg:justify-between lg:items-end gap-6">
      <div class="max-w-2xl">
        <span class="badge">Protected area</span>
        <h1 class="mt-5 font-semibold text-4xl sm:text-5xl tracking-tight">
          {title}
        </h1>
        <p class="mt-4 text-base-content/70 text-lg leading-8">
          {description}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <nav aria-label="Dashboard navigation" class="flex flex-wrap gap-2">
          {#each links as link (link.href)}
            <a
              class="btn btn-sm {page.route === link.href ? 'btn-active' : 'btn-ghost'}"
              href={link.href}
              aria-current={page.route === link.href ? "page" : undefined}>{link.label}</a>
          {/each}
        </nav>
        <form action="/auth/logout" method="post">
          <button class="btn btn-sm" type="submit">Sign out</button>
        </form>
      </div>
    </header>

    {@render children()}

    <footer class="text-sm text-base-content/60">
      Demo session protected by an HttpOnly cookie.
    </footer>
  </div>
</main>
