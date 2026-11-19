const $ = (id) => document.getElementById(id);
const statusLabel = {
  ok: "Ready for review", pending: "Ready for review", needs_review: "Needs review",
  needs_verification: "Needs verification", confirmed: "Confirmed"
};
const priorityLabel = { urgent: "Urgent", unread: "Unread", watch: "Watch", routine: "Routine" };
const uploadedSources = new Map();
let currentReports = [];
let activeWorkspace = "";
let openedReport = "";
let selectedHeat = null;
let patientRequest = 0;

async function api(path, options) {
  const response = await fetch("/api/" + path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(data?.error ?? "Flask returned HTTP " + response.status + ".");
    error.status = response.status;
    throw error;
  }
  return data;
}

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function reading(test) {
  if (!test) return "No readable test value";
  const result = [test.value, test.unit].filter(value => value != null && value !== "").join(" ");
  const range = test.range_low != null && test.range_high != null
    ? " (printed range " + test.range_low + "–" + test.range_high + ")" : "";
  return test.name + " · " + (result || "unreadable") + range;
}

function reportName(report) {
  return report.patient_name ?? "Unmatched report #" + report.id;
}

function reportSource(report, onReady = () => {}) {
  const box = node("div");
  box.className = "source-attachment";
  const note = node("p", "Original unavailable here. Check the screenshot from the intake channel.");
  note.className = "source-note";
  box.append(note);
  const sessionSource = uploadedSources.get(report.id);
  let source = sessionSource;
  if (!source && report.image_url) {
    try {
      const candidate = new URL(report.image_url, location.origin);
      if (candidate.protocol === "https:" || candidate.protocol === "http:") source = candidate.href;
    } catch { /* Keep the missing-source message for invalid URLs. */ }
  }
  if (!source) {
    onReady();
    return box;
  }
  note.textContent = "Original report";
  const image = node("img");
  image.className = "source-image";
  image.alt = "Original lab report screenshot";
  image.loading = "lazy";
  const zoom = node("a", "Open full-size original ↗");
  zoom.className = "source-open";
  zoom.href = source;
  zoom.target = "_blank";
  zoom.rel = "noopener";
  image.addEventListener("load", onReady, { once: true });
  image.addEventListener("error", () => {
    image.hidden = zoom.hidden = true;
    note.textContent = "The image could not load. Check the screenshot from the intake channel.";
    onReady();
  }, { once: true });
  image.src = source;
  box.append(image, zoom);
  return box;
}

function renderReport(report) {
  const row = $("report-template").content.firstElementChild.cloneNode(true);
  row.id = "report-" + report.id;
  row.querySelector("h3").textContent = reportName(report);
  const priority = row.querySelector(".priority");
  priority.textContent = priorityLabel[report.level] ?? "Unranked";
  priority.dataset.level = report.level;
  const timestamp = new Date(report.received_at);
  const date = report.received_at && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString() : "";
  row.querySelector(".metadata").textContent = [report.source, statusLabel[report.status], date]
    .filter(Boolean).join(" · ");
  row.querySelector(".finding").textContent = reading(report.worst);
  const review = row.querySelector("input");
  const confirm = row.querySelector(".confirm");
  review.disabled = true;
  row.querySelector(".source-attachment").replaceWith(reportSource(report, () => { review.disabled = false; }));
  const values = row.querySelector(".review-reading");
  values.append(node("h4","Extracted values"),node("p",reading(report.worst)));
  const details = row.querySelector("details");
  if (report.patient_id) {
    details.addEventListener("toggle", async () => {
      if (!details.open || details.dataset.valuesLoaded) return;
      details.dataset.valuesLoaded = "true";
      try {
        const patient = await api("patients/" + encodeURIComponent(report.patient_id));
        const tests = patient.reports?.find(item => item.id === report.id)?.tests;
        if (!tests?.length) return;
        const list = node("ul");
        for (const test of tests) list.append(node("li",reading(test)));
        values.replaceChildren(node("h4","Extracted values"),list);
      } catch {
        delete details.dataset.valuesLoaded;
      }
    });
  }
  review.closest("label").hidden = confirm.hidden = report.status === "confirmed";
  review.addEventListener("change", () => { confirm.disabled = !review.checked; });
  confirm.addEventListener("click", async () => {
    if (!review.checked) return;
    confirm.disabled = review.disabled = true;
    const message = row.querySelector(".confirm-message");
    message.textContent = "Confirming…";
    try {
      await api("reports/" + report.id + "/confirm", { method: "POST" });
      message.textContent = "Reading confirmed.";
      confirm.hidden = review.closest("label").hidden = true;
      await Promise.all([loadInbox(), loadPatient($("patients").value)]);
    } catch (error) {
      message.textContent = error.message;
      confirm.disabled = review.disabled = false;
    }
  });
  if (report.caption) row.insertBefore(node("p", report.caption), row.querySelector("details"));
  return row;
}

function renderInbox() {
  const pendingOnly = $("pending-only").checked;
  const listed = pendingOnly ? currentReports.filter(report => report.status !== "confirmed") : currentReports;
  $("queue").replaceChildren(...listed.map(renderReport));
  $("queue-message").textContent = listed.length
    ? listed.length + " report(s) · Highest priority first"
    : pendingOnly ? "No reports awaiting review." : "No reports yet.";
}

const heatLevels = { urgent: "Urgent", unread: "Unread", watch: "Watch", routine: "Routine", other: "Unranked" };

function previewHeat(report) {
  const link = $("heat-open");
  link.hidden = !report;
  if (!report) {
    $("heat-selection").textContent = "No reports in the inbox yet.";
    return;
  }
  const priority = priorityLabel[report.level] ?? "Unranked";
  $("heat-selection").textContent = [reportName(report), priority, reading(report.worst)].join(" · ");
  link.href = "/nabz/clinic.html?view=review&report=" + encodeURIComponent(report.id);
}

function renderHeatmap() {
  const rows = $("heatmap-rows");
  rows.replaceChildren();
  selectedHeat = currentReports.find(report => report.id === selectedHeat?.id) ?? currentReports[0] ?? null;
  for (const [level, label] of Object.entries(heatLevels)) {
    const reports = currentReports.filter(report => (priorityLabel[report.level] ? report.level : "other") === level);
    if (!reports.length && level === "other") continue;
    const row = node("div");
    row.className = "heat-row";
    row.dataset.level = level;
    const key = node("span", label + " (" + reports.length + ")");
    key.className = "heat-key";
    const tiles = node("div");
    tiles.className = "heat-tiles";
    for (const report of reports) {
      const button = node("button");
      button.type = "button";
      button.className = "heat-tile";
      button.setAttribute("aria-label", label + " report for " + reportName(report));
      button.setAttribute("aria-pressed", String(report.id === selectedHeat?.id));
      button.addEventListener("pointerenter", () => previewHeat(report));
      button.addEventListener("pointerleave", () => previewHeat(selectedHeat));
      button.addEventListener("focus", () => previewHeat(report));
      button.addEventListener("click", () => {
        selectedHeat = report;
        for (const tile of rows.querySelectorAll("button")) tile.setAttribute("aria-pressed", String(tile === button));
        previewHeat(report);
      });
      tiles.append(button);
    }
    row.append(key, tiles);
    rows.append(row);
  }
  previewHeat(selectedHeat);
}

function openReportFromLink() {
  const id = new URLSearchParams(location.search).get("report");
  if (!id || openedReport === id) return;
  const row = $("report-" + id);
  if (!row) return;
  openedReport = id;
  const details = row.querySelector("details");
  details.open = true;
  row.scrollIntoView({ block: "center" });
  details.querySelector("summary").focus({ preventScroll: true });
}

async function loadInbox() {
  $("refresh").disabled = $("heat-refresh").disabled = true;
  $("queue-message").textContent = "Loading reports…";
  try {
    currentReports = await api("inbox");
    renderInbox();
    if(activeWorkspace === "overview")renderHeatmap();
    if(activeWorkspace === "review")openReportFromLink();
  } catch (error) {
    $("heat-selection").textContent = "Could not load clinic reports.";
    $("queue-message").textContent = "Could not load the queue. " + error.message;
  } finally {
    $("refresh").disabled = $("heat-refresh").disabled = false;
  }
}

async function loadPatients() {
  const select = $("patients");
  const previous = select.value;
  try {
    const patients = await api("patients");
    select.replaceChildren(new Option("Select a patient", ""));
    for (const patient of patients) {
      select.add(new Option(patient.name, patient.id));
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    select.disabled = !patients.length;
    $("patients-message").textContent = patients.length ? "" : "No patients yet.";
  } catch (error) {
    $("patients-message").textContent = "Could not load patients. " + error.message;
  }
}

async function loadPatient(id) {
  const request = ++patientRequest;
  $("patient-detail").replaceChildren();
  if (!id) {
    if (!$("patients").disabled) $("patients-message").textContent = "";
    return;
  }
  $("patients-message").textContent = "Loading history…";
  try {
    const { patient, reports } = await api("patients/" + id);
    if (request !== patientRequest) return;
    const records = node("ul");
    records.className = "history-list";
    for (const report of reports) {
      const row = node("li");
      row.append(node("strong", [report.report_date, statusLabel[report.status]].filter(Boolean).join(" · ")));
      const values = node("ul");
      for (const test of report.tests ?? []) values.append(node("li", reading(test)));
      if (!values.children.length) values.append(node("li", "No readable test values"));
      const layout = node("div");
      layout.className = "source-layout";
      layout.append(reportSource(report), values);
      row.append(layout);
      records.append(row);
    }
    $("patient-detail").append(node("h3", patient.name), reports.length ? records : node("p", "No reports for this patient yet."));
    $("patients-message").textContent = "";
  } catch (error) {
    if (request === patientRequest) $("patients-message").textContent = error.message;
  }
}

$("upload").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = $("report-file").files[0];
  if (!file) return;
  const result = $("upload-result");
  const message = $("upload-message");
  result.hidden = true;
  if (file.size > 10 * 1024 * 1024) {
    message.textContent = "Choose an image under 10 MB.";
    return;
  }
  const payload = new FormData(form);
  const submit = form.querySelector("button");
  submit.disabled = $("report-file").disabled = true;
  message.textContent = "Uploading and reading the screenshot…";
  try {
    const report = await api("reports", { method: "POST", body: payload });
    uploadedSources.set(report.id, URL.createObjectURL(file));
    result.textContent = [priorityLabel[report.level], statusLabel[report.status], reading(report.worst)]
      .filter(Boolean).join(" · ");
    const reviewLink = node("a", "Review uploaded report ↗");
    reviewLink.className = "action";
    reviewLink.href = "/nabz/clinic.html?view=review&report=" + encodeURIComponent(report.id);
    result.append(node("br"),reviewLink);
    result.hidden = false;
    message.textContent = "Report #" + report.id + " received.";
    form.reset();
    await Promise.all([loadInbox(), loadPatients(), loadPatient($("patients").value)]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = $("report-file").disabled = false;
  }
});

function showComparison(arrival, ranked) {
  const columns = node("div");
  columns.className = "proof-columns";
  for (const [title, reports] of [["Arrival order", arrival], ["Nabz order", ranked]]) {
    const column = node("div");
    const entries = node("ol");
    for (const report of reports) {
      entries.append(node("li", reportName(report) + " · " + (priorityLabel[report.level] ?? "Unranked")));
    }
    column.append(node("h3", title), entries);
    columns.append(column);
  }
  $("proof-result").replaceChildren(columns);
}

$("compare").addEventListener("click", async () => {
  const button = $("compare");
  const message = $("proof-message");
  button.disabled = true;
  message.textContent = "Loading comparison…";
  $("proof-result").replaceChildren();
  try {
    const data = await api("compare");
    const arrival = data.arrival_order ?? data.arrival;
    const ranked = data.nabz_order ?? data.ranked;
    if (!Array.isArray(arrival) || !Array.isArray(ranked)) throw new Error("Comparison response format is unavailable.");
    showComparison(arrival, ranked);
    message.textContent = "Comparison from Flask.";
  } catch (error) {
    if (error.status === 404) {
      const reports = await api("inbox").catch(() => []);
      if (!reports.length) { message.textContent = "No reports available to compare."; return; }
      const byArrival = [...reports].sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
      showComparison(byArrival, reports);
      message.textContent = "Computed from the current review queue.";
    } else {
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

const workspaceViews = {
  overview: ["Clinic inbox", "See which reports need review and open the original case.", ["urgency", "review-queue"]],
  intake: ["Screenshot intake", "Upload a lab screenshot to add it to the review queue.", ["upload-panel"]],
  review: ["Review reports", "Compare each reading with its source before confirming.", ["review-queue"]],
  patients: ["Patient history", "Open a patient record to see prior reports and test values.", ["patient-history"]],
  comparison: ["Queue comparison", "See where urgent reports land in arrival order and in Nabz order.", ["comparison"]]
};

async function openWorkspace() {
  const query = new URLSearchParams(location.search);
  const linkedView = { "#upload-panel": "intake", "#patient-history": "patients", "#comparison": "comparison" };
  const view = query.get("view") || linkedView[location.hash] || "overview";
  activeWorkspace = Object.hasOwn(workspaceViews, view) ? view : "overview";
  openedReport = "";
  const [title, description, visible] = workspaceViews[activeWorkspace];
  document.body.dataset.workspace = activeWorkspace;
  document.title = "Nabz · " + title;
  $("workspace-title").textContent = title;
  $("workspace-description").textContent = description;
  $("clinic-visual").hidden = activeWorkspace !== "overview";
  for (const id of ["urgency", "review-queue", "upload-panel", "patient-history", "comparison"]) {
    $(id).hidden = !visible.includes(id);
  }
  for (const link of document.querySelectorAll("[data-workspace]")) {
    if (link.dataset.workspace === activeWorkspace) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("pending-only").checked = query.get("review") === "pending";
  if (activeWorkspace === "overview" || activeWorkspace === "review") {
    await loadInbox();
    if (location.hash === "#urgency") $("urgency").scrollIntoView();
  }
  if (activeWorkspace === "patients") {
    await loadPatients();
    if (activeWorkspace !== "patients") return;
    const requested = query.get("patient");
    const select = $("patients");
    if (requested && [...select.options].some(option => option.value === requested)) {
      select.value = requested;
      loadPatient(requested);
    }
  }
  if (activeWorkspace === "comparison") $("compare").click();
}

document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = new URL(link.href);
  if (target.origin !== location.origin || target.pathname !== location.pathname) return;
  event.preventDefault();
  history.pushState({}, "", target);
  window.scrollTo(0, 0);
  openWorkspace();
});
window.addEventListener("popstate", openWorkspace);
$("patients").addEventListener("change", () => loadPatient($("patients").value));
$("refresh").addEventListener("click", loadInbox);
$("heat-refresh").addEventListener("click", loadInbox);
$("pending-only").addEventListener("change", renderInbox);
api("health")
  .then(data => { $("server").textContent = data.ok ? "Clinic connected" : "Connection unavailable"; })
  .catch(() => { $("server").textContent = "Clinic disconnected"; });
openWorkspace();
