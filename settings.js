document.addEventListener("DOMContentLoaded", () => {
    const cogBtn = document.getElementById("cogBtn");
    const cogDropdown = document.getElementById("cogDropdown");

    cogBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cogDropdown.classList.toggle("hidden");
      cogBtn.classList.toggle("active");
    });

    document.addEventListener("click", () => {
      cogDropdown.classList.add("hidden");
      cogBtn.classList.remove("active");
    });
  });