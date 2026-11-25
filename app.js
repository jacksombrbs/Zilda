const URL_PLANILHA = "https://script.google.com/macros/s/AKfycbxH5-y7ZzMH8VK-WSalSWPIqDd9nbn0kwGujZxEKu12Vpp4M2ODtdQhquD58FVxmNiCNw/exec";
const URL_FIREBASE = "https://zilda-9776b-default-rtdb.firebaseio.com/";
const SENHA_MODOS = "2026";

const ESTADO_PADRAO = {
  participante: "AGUARDANDO PARTICIPANTE...",
  etapa: "INICIO",
  nivel: "1",
  pergunta_id: "",
  resposta_escolhida: "",
  acertou: "",
  premio_atual: ""
};

let bancoPerguntas = [];
let filasSorteio = { 1: [], 2: [] };
let modoAtual = "participante";
let modoSolicitado = null;
let alternativaSelecionada = "";
let temporizadorResposta = null;

let bancoFirebase = null;
let refEstado = null;
let refHistorico = null;
let refEncerrar = null;
let refConexao = null;
let ouvintesAtivos = false;
let primeiroEventoEncerrar = true;
let ultimoEstadoRecebido = null;

let estadoJogo = {
  participante: "AGUARDANDO PARTICIPANTE...",
  etapa: "INICIO",
  nivel: 1,
  perguntaAtual: null,
  respostaEscolhida: "",
  acertou: null,
  premio: ""
};

document.addEventListener("DOMContentLoaded", async () => {
  configurarEventos();
  inicializarFirebase();

  const parametros = new URLSearchParams(window.location.search);
  const modoUrl = parametros.get("modo");
  if (modoUrl === "apresentador" || modoUrl === "tv") {
    ativarModo(modoUrl);
  } else {
    ativarModo("participante");
  }

  await carregarPerguntas();
});

function inicializarFirebase() {
  if (!URL_FIREBASE || typeof firebase === "undefined") {
    return false;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp({ databaseURL: URL_FIREBASE });
  }

  bancoFirebase = firebase.database();
  refEstado = bancoFirebase.ref("desafio_zilda/estado");
  refHistorico = bancoFirebase.ref("desafio_zilda/historico");
  refEncerrar = bancoFirebase.ref("desafio_zilda/comando_encerrar");
  refConexao = bancoFirebase.ref(".info/connected");

  refEncerrar.on("value", () => {
    if (primeiroEventoEncerrar) {
      primeiroEventoEncerrar = false;
      return;
    }
    if (modoAtual === "participante" && estadoJogo.etapa !== "INICIO") {
      limparEstadoLocalParticipante();
    }
  });

  return true;
}

function configurarEventos() {
  document.getElementById("botao-modo-participante").addEventListener("click", () => solicitarTrocaModo("participante"));
  document.getElementById("botao-modo-apresentador").addEventListener("click", () => solicitarTrocaModo("apresentador"));
  document.getElementById("botao-modo-tv").addEventListener("click", () => solicitarTrocaModo("tv"));

  document.getElementById("formulario-senha").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const senhaDigitada = document.getElementById("campo-senha").value.trim();
    if (senhaDigitada === SENHA_MODOS) {
      fecharModalSenha();
      if (modoSolicitado) ativarModo(modoSolicitado);
      modoSolicitado = null;
    } else {
      document.getElementById("erro-senha").classList.remove("oculto");
      document.getElementById("campo-senha").select();
    }
  });

  document.getElementById("botao-cancelar-senha").addEventListener("click", fecharModalSenha);

  document.getElementById("formulario-inicio").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const nome = document.getElementById("campo-nome").value.trim().toUpperCase();
    if (!nome || bancoPerguntas.length === 0) return;
    iniciarRodada(nome);
  });

  document.getElementById("botao-confirmar-resposta").addEventListener("click", () => {
    if (!alternativaSelecionada || estadoJogo.respostaEscolhida) return;
    responderAlternativa(alternativaSelecionada);
  });

  document.getElementById("botao-parar").addEventListener("click", pararNaPrimeiraPergunta);
  document.getElementById("botao-avancar").addEventListener("click", avancarParaSegundaPergunta);
  document.getElementById("botao-proximo").addEventListener("click", reiniciarParaInicio);

  document.getElementById("botao-atualizar-lista").addEventListener("click", recarregarManual);

  document.getElementById("botao-limpar-lista").addEventListener("click", () => {
    document.getElementById("modal-limpar").classList.remove("oculto");
  });
  document.getElementById("botao-cancelar-limpar").addEventListener("click", () => {
    document.getElementById("modal-limpar").classList.add("oculto");
  });
  document.getElementById("botao-confirmar-limpar").addEventListener("click", limparListaParticipantes);

  document.getElementById("botao-encerrar-participacao").addEventListener("click", () => {
    document.getElementById("modal-encerrar").classList.remove("oculto");
  });
  document.getElementById("botao-cancelar-encerrar").addEventListener("click", () => {
    document.getElementById("modal-encerrar").classList.add("oculto");
  });
  document.getElementById("botao-confirmar-encerrar").addEventListener("click", encerrarParticipacaoAtual);
}

function solicitarTrocaModo(destino) {
  if (destino === modoAtual) return;

  if (modoAtual === "apresentador") {
    ativarModo(destino);
    return;
  }

  modoSolicitado = destino;
  const nomes = {
    participante: "Participante",
    apresentador: "Apresentador",
    tv: "TV"
  };

  document.getElementById("texto-destino-modo").textContent =
    `Digite a senha para mudar para o modo ${nomes[destino]}:`;
  document.getElementById("campo-senha").value = "";
  document.getElementById("erro-senha").classList.add("oculto");
  document.getElementById("modal-senha").classList.remove("oculto");
  setTimeout(() => document.getElementById("campo-senha").focus(), 50);
}

function fecharModalSenha() {
  document.getElementById("modal-senha").classList.add("oculto");
  document.getElementById("campo-senha").value = "";
  document.getElementById("erro-senha").classList.add("oculto");
}

function ativarModo(modo) {
  modoAtual = modo;
  document.body.className = `modo-${modo}`;

  const visoes = {
    participante: document.getElementById("visao-participante"),
    apresentador: document.getElementById("visao-apresentador"),
    tv: document.getElementById("visao-tv")
  };

  const botoes = {
    participante: document.getElementById("botao-modo-participante"),
    apresentador: document.getElementById("botao-modo-apresentador"),
    tv: document.getElementById("botao-modo-tv")
  };

  Object.keys(visoes).forEach((chave) => {
    visoes[chave].classList.toggle("oculto", chave !== modo);
    botoes[chave].classList.toggle("ativo", chave === modo);
  });

  if (modo === "apresentador" || modo === "tv") {
    conectarPaineisTempoReal();
  } else {
    desconectarPaineisTempoReal();
  }
}

function conectarPaineisTempoReal() {
  const status = document.getElementById("status-conexao");

  if (!bancoFirebase) {
    status.textContent = "CONFIGURE O FIREBASE";
    status.classList.add("desconectado");
    return;
  }

  if (ouvintesAtivos) return;
  ouvintesAtivos = true;

  refConexao.on("value", (snapshot) => {
    if (snapshot.val() === true) {
      status.textContent = "CONECTADO";
      status.classList.remove("desconectado");
    } else {
      status.textContent = "SEM CONEXÃO";
      status.classList.add("desconectado");
    }
  });

  refEstado.on("value", (snapshot) => {
    ultimoEstadoRecebido = snapshot.val() || ESTADO_PADRAO;
    atualizarApresentador(ultimoEstadoRecebido);
    atualizarTv(ultimoEstadoRecebido);
  });

  refHistorico.limitToLast(25).on("value", (snapshot) => {
    const lista = [];
    snapshot.forEach((filho) => {
      const item = filho.val();
      if (item) lista.push(item);
    });
    lista.reverse();
    atualizarListas(lista);
  });
}

function desconectarPaineisTempoReal() {
  if (!ouvintesAtivos || !bancoFirebase) return;
  refConexao.off();
  refEstado.off();
  refHistorico.off();
  ouvintesAtivos = false;
}

async function recarregarManual() {
  if (bancoPerguntas.length === 0) {
    await carregarPerguntas();
  }
  if (!bancoFirebase) return;

  const [snapEstado, snapHistorico] = await Promise.all([
    refEstado.once("value"),
    refHistorico.limitToLast(25).once("value")
  ]);

  ultimoEstadoRecebido = snapEstado.val() || ESTADO_PADRAO;
  atualizarApresentador(ultimoEstadoRecebido);
  atualizarTv(ultimoEstadoRecebido);

  const lista = [];
  snapHistorico.forEach((filho) => {
    const item = filho.val();
    if (item) lista.push(item);
  });
  lista.reverse();
  atualizarListas(lista);
}

async function carregarPerguntas() {
  const aviso = document.getElementById("aviso-conexao-inicio");
  const botaoIniciar = document.getElementById("botao-iniciar");

  try {
    const resposta = await fetch(`${URL_PLANILHA}?acao=perguntas`, { cache: "no-store" });
    const dados = await resposta.json();

    if (Array.isArray(dados.perguntas) && dados.perguntas.length > 0) {
      bancoPerguntas = dados.perguntas.filter((item) => Number(item.nivel) === 1 || Number(item.nivel) === 2);
      filasSorteio = { 1: [], 2: [] };
      aviso.classList.add("oculto");
      botaoIniciar.disabled = false;

      if (ultimoEstadoRecebido) {
        atualizarApresentador(ultimoEstadoRecebido);
        atualizarTv(ultimoEstadoRecebido);
      }
      return;
    }
  } catch (erro) {}

  bancoPerguntas = [];
  aviso.classList.remove("oculto");
  botaoIniciar.disabled = true;
}

function enviarParaPlanilhaEmSegundoPlano(dados) {
  try {
    fetch(URL_PLANILHA, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(dados)
    }).catch(() => {});
  } catch (erro) {}
}

function montarPayloadEstado() {
  return {
    participante: estadoJogo.participante,
    etapa: estadoJogo.etapa,
    nivel: String(estadoJogo.nivel),
    pergunta_id: estadoJogo.perguntaAtual ? String(estadoJogo.perguntaAtual.id) : "",
    resposta_escolhida: estadoJogo.respostaEscolhida,
    acertou: estadoJogo.acertou === null ? "" : (estadoJogo.acertou ? "SIM" : "NAO"),
    premio_atual: estadoJogo.premio
  };
}

function enviarEstadoAtual() {
  if (!refEstado) return;
  refEstado.set(montarPayloadEstado());
}

function limparListaParticipantes() {
  document.getElementById("modal-limpar").classList.add("oculto");
  if (refHistorico) {
    refHistorico.remove();
  }
  enviarParaPlanilhaEmSegundoPlano({ acao: "limpar_historico" });
}

function encerrarParticipacaoAtual() {
  document.getElementById("modal-encerrar").classList.add("oculto");
  limparEstadoLocalParticipante();
  if (refEstado) {
    refEstado.set({ ...ESTADO_PADRAO });
  }
  if (refEncerrar) {
    refEncerrar.set(Date.now());
  }
}

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function sortearPergunta(nivel) {
  const grupo = bancoPerguntas.filter((item) => Number(item.nivel) === nivel);
  if (grupo.length === 0) return null;

  if (filasSorteio[nivel].length === 0) {
    filasSorteio[nivel] = embaralhar(grupo);
  }

  return filasSorteio[nivel].pop();
}

function listarAlternativas(pergunta) {
  return [
    { letra: "A", texto: String(pergunta.alt_a ?? "") },
    { letra: "B", texto: String(pergunta.alt_b ?? "") },
    { letra: "C", texto: String(pergunta.alt_c ?? "") },
    { letra: "D", texto: String(pergunta.alt_d ?? "") }
  ];
}

function obterTextoAlternativa(pergunta, letra) {
  const letraLimpa = String(letra || "").trim().toUpperCase();
  const encontrada = listarAlternativas(pergunta).find((item) => item.letra === letraLimpa);
  return encontrada ? encontrada.texto : "";
}

function iniciarRodada(nome) {
  const primeira = sortearPergunta(1);
  if (!primeira) return;

  if (temporizadorResposta) {
    clearTimeout(temporizadorResposta);
    temporizadorResposta = null;
  }

  estadoJogo = {
    participante: nome,
    etapa: "PERGUNTA_1",
    nivel: 1,
    perguntaAtual: primeira,
    respostaEscolhida: "",
    acertou: null,
    premio: ""
  };

  exibirPergunta();
  enviarEstadoAtual();
}

function exibirPergunta() {
  exibirEtapa("etapa-pergunta");
  alternativaSelecionada = "";

  const pergunta = estadoJogo.perguntaAtual;
  const ehPrimeira = estadoJogo.nivel === 1;

  const numero = document.getElementById("numero-pergunta");
  numero.textContent = ehPrimeira ? "1" : "2";
  numero.className = `circulo-numero ${ehPrimeira ? "cor-verde" : "cor-vermelha"}`;

  document.getElementById("titulo-pergunta").textContent = ehPrimeira ? "PERGUNTA 1" : "PERGUNTA 2";
  document.getElementById("nome-participante").textContent = estadoJogo.participante;
  document.getElementById("enunciado-pergunta").textContent = String(pergunta.pergunta ?? "").toUpperCase();

  const container = document.getElementById("lista-alternativas");
  container.innerHTML = "";

  listarAlternativas(pergunta).forEach((opcao) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "botao-alternativa";
    botao.dataset.letra = opcao.letra;
    botao.innerHTML = `<span class="letra-alternativa">${opcao.letra}</span><span>${opcao.texto.toUpperCase()}</span>`;
    botao.addEventListener("click", () => selecionarAlternativa(opcao.letra));
    container.appendChild(botao);
  });

  const botaoConfirmar = document.getElementById("botao-confirmar-resposta");
  botaoConfirmar.disabled = true;
  botaoConfirmar.textContent = "SELECIONE UMA ALTERNATIVA";
}

function selecionarAlternativa(letra) {
  if (estadoJogo.respostaEscolhida) return;
  alternativaSelecionada = letra;

  document.querySelectorAll("#lista-alternativas .botao-alternativa").forEach((botao) => {
    botao.classList.toggle("selecionada", botao.dataset.letra === letra);
  });

  const botaoConfirmar = document.getElementById("botao-confirmar-resposta");
  botaoConfirmar.disabled = false;
  botaoConfirmar.textContent = `CONFIRMAR RESPOSTA (LETRA ${letra})`;
}

function responderAlternativa(letraEscolhida) {
  const correta = String(estadoJogo.perguntaAtual.correta ?? "").trim().toUpperCase();
  const acertou = letraEscolhida === correta;

  estadoJogo.respostaEscolhida = letraEscolhida;
  estadoJogo.acertou = acertou;

  const botaoConfirmar = document.getElementById("botao-confirmar-resposta");
  botaoConfirmar.disabled = true;
  botaoConfirmar.textContent = acertou ? "RESPOSTA CORRETA!" : "RESPOSTA INCORRETA";

  document.querySelectorAll("#lista-alternativas .botao-alternativa").forEach((botao) => {
    botao.disabled = true;
    botao.classList.remove("selecionada");
    if (botao.dataset.letra === correta) {
      botao.classList.add("correta");
    } else if (botao.dataset.letra === letraEscolhida && !acertou) {
      botao.classList.add("errada");
    }
  });

  enviarEstadoAtual();

  temporizadorResposta = setTimeout(() => {
    temporizadorResposta = null;
    if (acertou && estadoJogo.nivel === 1) {
      estadoJogo.etapa = "DECISAO_PARAR";
      estadoJogo.premio = "PRÊMIO GARANTIDO";
      document.getElementById("nome-decisao").textContent = estadoJogo.participante;
      exibirEtapa("etapa-decisao");
      enviarEstadoAtual();
    } else if (acertou && estadoJogo.nivel === 2) {
      encerrarRodada({
        titulo: "VOCÊ DOBROU SEU PRÊMIO!",
        resultadoHistorico: "ACERTOU AS 2 PERGUNTAS",
        premioHistorico: "PRÊMIO EM DOBRO",
        mensagem: "Parabéns! Você acertou as duas perguntas sobre a Dra. Zilda Arns.",
        corEmblema: "cor-verde",
        icone: "★",
        totalPerguntas: 2,
        exibirCorreta: false
      });
    } else {
      encerrarRodada({
        titulo: "NÃO FOI DESSA VEZ",
        resultadoHistorico: "NÃO ACERTOU",
        premioHistorico: "PARTICIPOU",
        mensagem: "Obrigado por participar do Desafio Zilda Arns da turma 2A!",
        corEmblema: "cor-vermelha",
        icone: "✕",
        totalPerguntas: estadoJogo.nivel,
        exibirCorreta: true
      });
    }
  }, 1300);
}

function pararNaPrimeiraPergunta() {
  encerrarRodada({
    titulo: "PRÊMIO GARANTIDO!",
    resultadoHistorico: "PAROU NA PERGUNTA 1",
    premioHistorico: "PRÊMIO GARANTIDO",
    mensagem: "Ótima escolha! Você parou com segurança e garantiu o seu prêmio.",
    corEmblema: "cor-amarela",
    icone: "✓",
    totalPerguntas: 1,
    exibirCorreta: false
  });
}

function avancarParaSegundaPergunta() {
  const segunda = sortearPergunta(2);
  if (!segunda) return;

  estadoJogo.etapa = "PERGUNTA_2";
  estadoJogo.nivel = 2;
  estadoJogo.perguntaAtual = segunda;
  estadoJogo.respostaEscolhida = "";
  estadoJogo.acertou = null;
  estadoJogo.premio = "";

  exibirPergunta();
  enviarEstadoAtual();
}

function encerrarRodada({
  titulo,
  resultadoHistorico,
  premioHistorico,
  mensagem,
  corEmblema,
  icone,
  totalPerguntas,
  exibirCorreta
}) {
  estadoJogo.etapa = "RESULTADO";
  estadoJogo.premio = premioHistorico;

  const emblema = document.getElementById("icone-resultado");
  emblema.className = `circulo-numero ${corEmblema}`;
  emblema.textContent = icone;

  document.getElementById("nome-resultado").textContent = estadoJogo.participante;
  document.getElementById("titulo-resultado").textContent = titulo;
  document.getElementById("mensagem-resultado").textContent = mensagem;

  const caixaCorreta = document.getElementById("caixa-resposta-correta");
  if (exibirCorreta && estadoJogo.perguntaAtual) {
    const letraCerta = String(estadoJogo.perguntaAtual.correta ?? "").trim().toUpperCase();
    document.getElementById("letra-resposta-correta").textContent = letraCerta;
    document.getElementById("texto-resposta-correta").textContent =
      obterTextoAlternativa(estadoJogo.perguntaAtual, letraCerta);
    caixaCorreta.classList.remove("oculto");
  } else {
    caixaCorreta.classList.add("oculto");
  }

  document.getElementById("caixa-curiosidade").textContent =
    estadoJogo.perguntaAtual ? String(estadoJogo.perguntaAtual.comentario_apresentador ?? "") : "";

  exibirEtapa("etapa-resultado");

  const registroHistorico = {
    participante: estadoJogo.participante,
    resultado_final: resultadoHistorico,
    premio: premioHistorico,
    perguntas_respondidas: String(totalPerguntas),
    ajuda_utilizada: ""
  };

  enviarEstadoAtual();
  if (refHistorico) {
    refHistorico.push(registroHistorico);
  }

  enviarParaPlanilhaEmSegundoPlano({
    acao: "registrar_historico",
    ...registroHistorico
  });
}

function limparEstadoLocalParticipante() {
  if (temporizadorResposta) {
    clearTimeout(temporizadorResposta);
    temporizadorResposta = null;
  }
  document.getElementById("campo-nome").value = "";
  alternativaSelecionada = "";
  estadoJogo = {
    participante: "AGUARDANDO PARTICIPANTE...",
    etapa: "INICIO",
    nivel: 1,
    perguntaAtual: null,
    respostaEscolhida: "",
    acertou: null,
    premio: ""
  };
  exibirEtapa("etapa-inicio");
}

function reiniciarParaInicio() {
  limparEstadoLocalParticipante();
  enviarEstadoAtual();
}

function exibirEtapa(idVisivel) {
  ["etapa-inicio", "etapa-pergunta", "etapa-decisao", "etapa-resultado"].forEach((id) => {
    document.getElementById(id).classList.toggle("oculto", id !== idVisivel);
  });
}

function nomearEtapa(etapa) {
  const mapa = {
    INICIO: "AGUARDANDO PARTICIPANTE",
    PERGUNTA_1: "RESPONDENDO A 1ª PERGUNTA",
    DECISAO_PARAR: "ESCOLHENDO: PARAR OU ARRISCAR A 2ª PERGUNTA",
    PERGUNTA_2: "RESPONDENDO A 2ª PERGUNTA (VALE O DOBRO)",
    RESULTADO: "RODADA ENCERRADA"
  };
  return mapa[etapa] || etapa || "AGUARDANDO PARTICIPANTE";
}

function atualizarApresentador(estado) {
  document.getElementById("apresentador-participante").textContent =
    estado.participante || "AGUARDANDO PARTICIPANTE...";
  document.getElementById("apresentador-etapa").textContent = nomearEtapa(estado.etapa);

  const botaoEncerrar = document.getElementById("botao-encerrar-participacao");
  botaoEncerrar.disabled = !estado.etapa || estado.etapa === "INICIO";

  const pergunta = bancoPerguntas.find((item) => Number(item.id) === Number(estado.pergunta_id));
  const enunciado = document.getElementById("apresentador-enunciado");
  const alternativas = document.getElementById("apresentador-alternativas");
  const gabarito = document.getElementById("apresentador-gabarito");
  const comentario = document.getElementById("apresentador-comentario");
  const faixaFeedback = document.getElementById("apresentador-feedback-resposta");

  if (!pergunta || estado.etapa === "INICIO") {
    document.getElementById("apresentador-rotulo-pergunta").textContent = "PERGUNTA SORTEADA";
    enunciado.textContent = "Nenhuma pergunta ativa no momento.";
    alternativas.innerHTML = "";
    gabarito.textContent = "—";
    comentario.textContent = "Aguardando o participante iniciar o desafio.";
    faixaFeedback.className = "feedback-apresentador oculto";
    faixaFeedback.textContent = "";
    return;
  }

  document.getElementById("apresentador-rotulo-pergunta").textContent =
    `PERGUNTA ${estado.nivel || pergunta.nivel} (#${pergunta.id})`;
  enunciado.textContent = String(pergunta.pergunta ?? "");

  const correta = String(pergunta.correta ?? "").trim().toUpperCase();
  const escolhida = String(estado.resposta_escolhida || "").trim().toUpperCase();
  gabarito.textContent = `LETRA ${correta}`;
  comentario.textContent = String(pergunta.comentario_apresentador ?? "");

  if (estado.etapa === "DECISAO_PARAR") {
    faixaFeedback.className = "feedback-apresentador decisao";
    faixaFeedback.textContent = "✓ ACERTOU A 1ª PERGUNTA! Está decidindo se para com o prêmio garantido ou arrisca a 2ª pergunta.";
  } else if (estado.etapa === "RESULTADO") {
    if (estado.acertou === "NAO") {
      faixaFeedback.className = "feedback-apresentador errou";
      faixaFeedback.textContent = `✕ ERROU! Escolheu a letra ${escolhida} — A correta era a letra ${correta}.`;
    } else if (String(estado.premio_atual || "").toUpperCase().includes("DOBRO")) {
      faixaFeedback.className = "feedback-apresentador acertou";
      faixaFeedback.textContent = "★ ACERTOU AS 2 PERGUNTAS! PRÊMIO EM DOBRO!";
    } else {
      faixaFeedback.className = "feedback-apresentador decisao";
      faixaFeedback.textContent = "✓ PAROU NA 1ª PERGUNTA E GARANTIU O PRÊMIO!";
    }
  } else if (estado.acertou === "SIM") {
    faixaFeedback.className = "feedback-apresentador acertou";
    faixaFeedback.textContent = `✓ ACERTOU! Escolheu a letra ${escolhida} (correta).`;
  } else if (estado.acertou === "NAO") {
    faixaFeedback.className = "feedback-apresentador errou";
    faixaFeedback.textContent = `✕ ERROU! Escolheu a letra ${escolhida} — A correta é a letra ${correta}.`;
  } else {
    faixaFeedback.className = "feedback-apresentador oculto";
    faixaFeedback.textContent = "";
  }

  alternativas.innerHTML = listarAlternativas(pergunta)
    .map((item) => {
      const classes = ["item-alternativa-apresentador"];
      if (item.letra === correta) classes.push("gabarito");

      let marcacao = "";
      if (escolhida === item.letra) {
        if (item.letra === correta) {
          classes.push("escolhida-correta");
          marcacao = " ← ESCOLHEU (ACERTOU ✓)";
        } else {
          classes.push("escolhida-errada");
          marcacao = " ← ESCOLHEU (ERROU ✕)";
        }
      }

      return `<div class="${classes.join(" ")}"><strong>${item.letra})</strong> ${item.texto}${marcacao}</div>`;
    })
    .join("");
}

function atualizarTv(estado) {
  const espera = document.getElementById("tv-espera");
  const ativo = document.getElementById("tv-ativo");
  const pergunta = bancoPerguntas.find((item) => Number(item.id) === Number(estado.pergunta_id));

  if (!pergunta || !estado.etapa || estado.etapa === "INICIO") {
    espera.classList.remove("oculto");
    ativo.classList.add("oculto");
    return;
  }

  espera.classList.add("oculto");
  ativo.classList.remove("oculto");

  const nivel = Number(estado.nivel) === 2 ? 2 : 1;
  const numero = document.getElementById("tv-numero-pergunta");
  numero.textContent = String(nivel);
  numero.className = `circulo-numero ${nivel === 1 ? "cor-verde" : "cor-vermelha"}`;

  document.getElementById("tv-titulo-pergunta").textContent = `PERGUNTA ${nivel}`;
  document.getElementById("tv-participante").textContent = estado.participante || "";
  document.getElementById("tv-enunciado").textContent = String(pergunta.pergunta ?? "").toUpperCase();

  const correta = String(pergunta.correta ?? "").trim().toUpperCase();
  const escolhida = String(estado.resposta_escolhida || "").trim().toUpperCase();
  const respondeu = escolhida !== "" || estado.etapa === "RESULTADO" || estado.etapa === "DECISAO_PARAR";

  document.getElementById("tv-alternativas").innerHTML = listarAlternativas(pergunta)
    .map((item) => {
      let classe = "alternativa-tv";
      if (respondeu) {
        if (item.letra === correta) classe += " correta";
        else if (item.letra === escolhida && escolhida !== correta) classe += " errada";
      }
      return `<div class="${classe}"><span class="letra-alternativa">${item.letra}</span><span>${item.texto.toUpperCase()}</span></div>`;
    })
    .join("");

  const faixa = document.getElementById("tv-faixa-resultado");
  if (estado.etapa === "DECISAO_PARAR") {
    faixa.className = "faixa-resultado-tv acerto";
    faixa.textContent = "✓ VOCÊ ACERTOU! PARAR E GARANTIR OU IR PARA A PERGUNTA 2?";
  } else if (estado.etapa === "RESULTADO") {
    if (estado.acertou === "NAO") {
      faixa.className = "faixa-resultado-tv erro";
      faixa.textContent = `✕ NÃO FOI DESSA VEZ — RESPOSTA CORRETA: ${correta}) ${obterTextoAlternativa(pergunta, correta).toUpperCase()}`;
    } else {
      faixa.className = "faixa-resultado-tv acerto";
      faixa.textContent = `✓ ${estado.participante} — ${estado.premio_atual || "PARABÉNS!"}`;
    }
  } else if (estado.acertou === "SIM") {
    faixa.className = "faixa-resultado-tv acerto";
    faixa.textContent = "✓ RESPOSTA CORRETA!";
  } else if (estado.acertou === "NAO") {
    faixa.className = "faixa-resultado-tv erro";
    faixa.textContent = `✕ RESPOSTA INCORRETA! A CORRETA É A LETRA ${correta}) ${obterTextoAlternativa(pergunta, correta).toUpperCase()}`;
  } else {
    faixa.className = "faixa-resultado-tv oculto";
    faixa.textContent = "";
  }
}

function renderizarItensHistorico(lista) {
  if (!lista || lista.length === 0) {
    return `<li class="item-vazio">Nenhum participante finalizado ainda.</li>`;
  }

  return lista
    .map((item) => {
      const resultado = String(item.resultado_final || "").toUpperCase();
      let classe = "";
      if (resultado.includes("2 PERGUNTAS") || resultado.includes("DOBRO")) classe = "dobrou";
      else if (resultado.includes("NÃO")) classe = "errou";

      const premio = item.premio && item.premio !== "PARTICIPOU"
        ? ` — <strong>${item.premio}</strong>`
        : "";

      return `
        <li class="item-participante ${classe}">
          <div class="topo-item-participante">
            <span>${item.participante}</span>
          </div>
          <div>${item.resultado_final}${premio}</div>
        </li>
      `;
    })
    .join("");
}

function atualizarListas(lista) {
  document.getElementById("lista-apresentador").innerHTML = renderizarItensHistorico(lista);
  document.getElementById("lista-tv").innerHTML = renderizarItensHistorico((lista || []).slice(0, 7));
}