/**
 * Injected on demand by lib/scraper.ts (never auto-registered). Scrolls the page
 * to trigger lazy-loaded content, then returns its title and body HTML.
 */
export default defineContentScript({
  registration: "runtime",
  main() {
    // Scraper tabs are hidden, so Chrome clamps every timer to >=1s and, after
    // 5 minutes, to ~1/min. On a long page an unbounded scroll never finishes;
    // stop at this budget and return whatever has rendered by then.
    const SCROLL_BUDGET_MS = 15_000;

    // Function to scroll the page
    const scrollPage = async () => {
      const startedAt = performance.now();
      const scrollHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;
      // Scroll 80% of viewport height each time; never 0, or the loop can't advance
      const scrollDistance = Math.max(viewportHeight * 0.8, 400);
      let currentPosition = 0;

      // Scroll down the page in increments
      while (
        currentPosition < scrollHeight &&
        performance.now() - startedAt < SCROLL_BUDGET_MS
      ) {
        window.scrollTo(0, currentPosition);
        currentPosition += scrollDistance;

        // Wait for content to load (adjust delay as needed)
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Scroll to the very bottom
      window.scrollTo(0, scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Back to the top
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    const convertPageToHTML = async () => {
      // Scroll the page first to trigger lazy-loaded content
      await scrollPage();

      // Return raw HTML and title after scrolling
      return {
        title: document.title,
        html: document.body.innerHTML,
      };
    };

    // executeScript resolves with this value
    return convertPageToHTML();
  },
});
