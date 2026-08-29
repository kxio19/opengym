const rankings = {
  global: { title: "Clasificación global", scores: ["96,8 pt", "87,4 pt", "76,1 pt", "68,2 pt", "59,7 pt"] },
  volumen: { title: "Volumen total", scores: ["100 pt", "91,6 pt", "78,3 pt", "69,1 pt", "52,8 pt"] },
  constancia: { title: "Días entrenados", scores: ["5 días", "4 días", "4 días", "3 días", "2 días"] },
  tiempo: { title: "Tiempo entrenado", scores: ["248 min", "219 min", "193 min", "170 min", "142 min"] },
  prs: { title: "Nuevas marcas", scores: ["4 PR", "3 PR", "2 PR", "2 PR", "1 PR"] },
  racha: { title: "Racha semanal", scores: ["12 sem", "9 sem", "7 sem", "5 sem", "3 sem"] }
};

const tabs = [...document.querySelectorAll(".rank-tab")];
tabs.forEach((tab) => tab.addEventListener("click", () => {
  tabs.forEach((item) => {
    const selected = item === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  const rank = rankings[tab.dataset.rank];
  document.querySelector("#ranking-title").textContent = rank.title;
  rank.scores.forEach((score, index) => {
    document.querySelector(`#score-${index + 1}`).textContent = score;
  });
}));
