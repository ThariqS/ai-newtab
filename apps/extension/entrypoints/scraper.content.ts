/**
 * Injected on demand by lib/scraper.ts (never auto-registered). Scrolls the page
 * to trigger lazy-loaded content, then returns its title and body HTML.
 */
export default defineContentScript({
  registration: "runtime",
  main() {
    // Scrolling only nudges lazy content into view, so it gets a fixed budget.
    // Timers in a background tab are heavily throttled, and on a long page an
    // unbounded walk can take minutes.
    const SCROLL_BUDGET_MS = 5000;

    // Function to scroll the page
    const scrollPage = async () => {
      const deadline = Date.now() + SCROLL_BUDGET_MS;
      const scrollHeight = document.documentElement.scrollHeight;
      // A tab that has never been shown can report a zero-height viewport, and a
      // zero step would never advance.
      const viewportHeight = window.innerHeight || 800;
      const scrollDistance = viewportHeight * 0.8; // Scroll 80% of viewport height each time
      let currentPosition = 0;

      // Scroll down the page in increments
      while (currentPosition < scrollHeight && Date.now() < deadline) {
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
        url: location.href,
        title: document.title,
        html: document.body.innerHTML,
      };
    };

    // executeScript resolves with this value
    return convertPageToHTML();
  },
});
