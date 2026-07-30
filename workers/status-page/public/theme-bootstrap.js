(() => {
  const storedTheme = () => {
    let localTheme = null;
    let cookieTheme = null;
    try {
      localTheme = localStorage.getItem("closespan-theme");
    } catch {
      // Continue with the shared domain cookie when local storage is blocked.
    }
    try {
      cookieTheme = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("closespan-theme="))
        ?.split("=")[1];
    } catch {
      // System preference remains available if cookies are blocked as well.
    }
    try {
      const savedTheme = localTheme || cookieTheme;
      return savedTheme === "light" || savedTheme === "dark" ? savedTheme : null;
    } catch {
      return null;
    }
  };

  const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#151b27" : "#e9eef7");
  };

  try {
    const savedTheme = storedTheme();
    applyTheme(
      savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
    );
  } catch {
    applyTheme("light");
  }

  const colorScheme = matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener("change", (event) => {
    if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
  });
})();
