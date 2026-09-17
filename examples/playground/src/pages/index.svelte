<main class="bg-base-200 px-4 sm:px-6 py-10 min-h-dvh">
  <div class="flex flex-col gap-16 mx-auto max-w-6xl">
    <header class="flex sm:flex-row flex-col sm:justify-between sm:items-center gap-6">
      <span class="badge-outline badge">Hono + Vite</span>
      <a class="btn btn-ghost" href="/auth">Sign in</a>
    </header>

    <section class="items-center gap-10 grid lg:grid-cols-[1.1fr_0.9fr]">
      <div class="max-w-2xl">
        <p class="font-medium text-sm text-base-content/60 uppercase tracking-[0.2em]">
          Public site
        </p>
        <h1 class="mt-5 font-semibold text-4xl sm:text-6xl tracking-tight">
          A simple starting point for Hono products.
        </h1>
        <p class="mt-6 max-w-xl text-base-content/70 text-lg leading-8">
          Browse the site, sign in to the authenticated area, and keep each
          surface loading only the client it needs.
        </p>
        <div class="flex flex-wrap gap-3 mt-8">
          <a class="btn" href="/auth">Open the demo</a>
          <a class="btn btn-ghost" href="#architecture">See the architecture</a>
        </div>
      </div>

      <div class="bg-base-100 shadow-sm card-border card">
        <div class="gap-5 card-body">
          <span class="badge badge-ghost">Separate entrypoints</span>
          <h2 class="text-2xl card-title">Each surface has its own client.</h2>
          <p class="text-base-content/70 leading-7">
            The public site, auth, and dashboard are independent bundles.
            The dashboard only receives its code after the session is
            validated.
          </p>
        </div>
      </div>
    </section>

    <section id="architecture" class="gap-6 grid md:grid-cols-3">
      <article class="bg-base-100 shadow-sm card-border card">
        <div class="gap-3 card-body">
          <span class="badge">01</span>
          <h2 class="text-xl card-title">Site</h2>
          <p class="text-base-content/70">Public content in a lean bundle.</p>
        </div>
      </article>
      <article class="bg-base-100 shadow-sm card-border card">
        <div class="gap-3 card-body">
          <span class="badge">02</span>
          <h2 class="text-xl card-title">Auth</h2>
          <p class="text-base-content/70">Sign-in form and flow, separate from the product.</p>
        </div>
      </article>
      <article class="bg-base-100 shadow-sm card-border card">
        <div class="gap-3 card-body">
          <span class="badge">03</span>
          <h2 class="text-xl card-title">Dashboard</h2>
          <p class="text-base-content/70">Sub-routes grouped in a protected client.</p>
        </div>
      </article>
    </section>
  </div>
</main>
