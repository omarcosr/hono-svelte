<script lang="ts">
  import { getPage } from "../../../src/page.js";

  const page = getPage();
</script>

<p class="info" data-path={page.path} data-route={page.route}>page info</p>
