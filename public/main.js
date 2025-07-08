// main.js

const apiKey = "pk.481f46d0a98c9a0b3fb99b5d1cbd9658";
const webhookUrl = "/enviar";
const dbName = "coletas_offline";
let db;

/**
 * 1) Abre o IndexedDB e, só no onsuccess, chama atualizarStatusPendentes()
 */
function abrirDB() {
  console.log("Abrindo IndexedDB...");
  const request = indexedDB.open(dbName, 1);
  request.onerror = () => console.error("Erro ao abrir o IndexedDB");

  request.onupgradeneeded = (event) => {
    console.log("Atualizando versão do DB...");
    const dbInst = event.target.result;
    if (!dbInst.objectStoreNames.contains("coletas")) {
      dbInst.createObjectStore("coletas", { autoIncrement: true });
    }
  };

  request.onsuccess = (event) => {
    db = event.target.result;
    console.log("IndexedDB aberto com sucesso:", dbName);
    atualizarStatusPendentes();
  };
}

/**
 * 2) Atualiza o contador de pendentes
 */
function atualizarStatusPendentes() {
  if (!db) return;
  const tx = db.transaction("coletas", "readonly");
  const store = tx.objectStore("coletas");
  const count = store.count();

  count.onsuccess = (e) => {
    const n = e.target.result;
    document.getElementById("statusPendentes").textContent =
      n > 0
        ? `${n} coleta(s) offline pendente(s)`
        : "Nenhuma coleta offline salva";
  };
  count.onerror = () => console.error("Erro ao contar coletas:", count.error);
}

/**
 * 3) Feedbacks visuais (usados apenas durante ações)
 */
function exibirLoading(m) {
  document.getElementById("loading").style.display = m ? "flex" : "none";
}
function exibirSucesso(m) {
  document.getElementById("sucesso").style.display = m ? "flex" : "none";
}
function exibirSincronizacao(m) {
  document.getElementById("sincronizacao").style.display = m ? "flex" : "none";
}

/**
 * 4) Geolocalização + reverse lookup
 */
function configurarGeolocalizacao() {
  document.getElementById("btnCoordenadas").addEventListener("click", () => {
    exibirLoading(true);
    if (!navigator.geolocation) {
      alert("Geolocalização não suportada.");
      exibirLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        document.getElementById("coordenadas").value = `${lat}, ${lon}`;
        try {
          const res = await fetch(
            `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json`
          );
          const data = await res.json();
          document.getElementById("rua").value = data.address.road || "";
          document.getElementById("bairro").value =
            data.address.suburb || data.address.neighbourhood || "";
          document.getElementById("cidade").value =
            data.address.city ||
            data.address.town ||
            data.address.village ||
            "";
        } catch {
          alert("Erro ao buscar endereço.");
        } finally {
          exibirLoading(false);
        }
      },
      () => {
        alert("Permissão negada para geolocalização.");
        exibirLoading(false);
      }
    );
  });
}

/**
 * 5) Envio do formulário + salvamento offline
 */
function configurarFormulario() {
  const form = document.getElementById("formulario");
  const btnNova = document.getElementById("btnNovaColeta");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    exibirLoading(true);

    const [lat, lon] = (
      document.getElementById("coordenadas").value || ","
    ).split(",");
    const files = document.getElementById("fotos").files;
    const fotosBase64 = [];
    let totalSize = 0;

    for (let i = 0; i < Math.min(files.length, 5); i++) {
      const f = files[i];
      totalSize += f.size;
      if (f.size > 50 * 1024 * 1024 || totalSize > 200 * 1024 * 1024) {
        alert("Limite de tamanho atingido.");
        exibirLoading(false);
        return;
      }
      fotosBase64.push(
        await new Promise((r) => {
          const reader = new FileReader();
          reader.onload = () => r(reader.result);
          reader.readAsDataURL(f);
        })
      );
    }

    const dados = {
      latitude: lat.trim(),
      longitude: lon.trim(),
      rua: document.getElementById("rua").value,
      bairro: document.getElementById("bairro").value,
      cidade: document.getElementById("cidade").value,
      fotos: fotosBase64,
    };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      console.log("Resposta:", await res.text());
      form.reset();
      exibirSucesso(true);
    } catch {
      console.warn("Offline. Salvando localmente.");
      db.transaction("coletas", "readwrite").objectStore("coletas").add(dados);
      atualizarStatusPendentes();
      alert("Coleta salva offline. Sincronize depois.");
    } finally {
      exibirLoading(false);
    }
  });

  btnNova.addEventListener("click", () => exibirSucesso(false));
}

/**
 * 6) Sincronização de pendentes
 */
function configurarSincronizacao() {
  document
    .getElementById("btnSincronizar")
    .addEventListener("click", async () => {
      if (!db) return;
      exibirLoading(true);

      const progresso = document.getElementById("progressoSincronizacao");
      const barraWrapper = document.getElementById("barraProgressoWrapper");
      const barra = document.getElementById("barraProgresso");
      barraWrapper.style.display = "block";
      progresso.textContent = "";
      barra.style.width = "0%";

      const store = db
        .transaction("coletas", "readonly")
        .objectStore("coletas");
      const allDados = await new Promise(
        (r) => (store.getAll().onsuccess = (e) => r(e.target.result))
      );
      const allKeys = await new Promise(
        (r) => (store.getAllKeys().onsuccess = (e) => r(e.target.result))
      );

      let enviado = 0;
      progresso.textContent = `Sincronizando 0 de ${allDados.length}`;

      for (let i = 0; i < allDados.length; i++) {
        try {
          const resp = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(allDados[i]),
          });
          if (resp.ok) {
            await new Promise(
              (del) =>
                (db
                  .transaction("coletas", "readwrite")
                  .objectStore("coletas")
                  .delete(allKeys[i]).onsuccess = del)
            );
            enviado++;
            progresso.textContent = `Sincronizando ${enviado} de ${allDados.length}`;
            barra.style.width = `${((enviado / allDados.length) * 100).toFixed(
              1
            )}%`;
          }
        } catch {
          console.error("Erro ao sincronizar.");
          progresso.textContent = "Erro ao sincronizar.";
          break;
        }
      }

      exibirLoading(false);
      atualizarStatusPendentes();
      if (enviado === allDados.length) {
        exibirSincronizacao(true);
        setTimeout(() => (barraWrapper.style.display = "none"), 1500);
      } else {
        barraWrapper.style.display = "none";
      }
    });

  document
    .getElementById("btnFecharSincronizacao")
    .addEventListener("click", () => exibirSincronizacao(false));
}

/**
 * Inicialização
 */
window.addEventListener("DOMContentLoaded", () => {
  // overlay de loading só aparece em ações do usuário
  exibirLoading(false);

  abrirDB();
  configurarGeolocalizacao();
  configurarFormulario();
  configurarSincronizacao();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then(() => console.log("✔ SW registrado."));
    });
  }
});
