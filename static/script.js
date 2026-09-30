let rawData = [];
let filterableColumns = [];
let selectedFilters = {};
let activeMetric = "";
let dateColumn = null;
let charts = {};
let dashboardBuilt = false;

const fileInput = document.getElementById("csv_file");
const uploadForm = document.getElementById("upload-form");
const emptyState = document.getElementById("empty-state");
const topbarFileInfo = document.getElementById("topbar-file-info");
const dropzone = document.querySelector(".upload-zone");

const CHART_COLORS = ["#F5A623", "#4FD1C5", "#7C93F5", "#E36D9E", "#8FD866", "#C99BF5"];
const ANIMATION = { duration: 500, easing: "easeOutQuart" };

document.getElementById("replace-file-btn").addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) {
        analyzeFile(fileInput.files[0]);
    }
});

uploadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (fileInput.files[0]) {
        analyzeFile(fileInput.files[0]);
    } else {
        fileInput.click();
    }
});

async function analyzeFile(file) {
    const btn = document.getElementById("analyze-btn");
    btn.innerText = "Analyzing...";
    btn.disabled = true;

    const formData = new FormData();
    formData.append("csv_file", file);

    try {
        const response = await fetch("/upload", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            alert(data.error);
            return;
        }

        rawData = data.records;
        filterableColumns = data.filterable_columns;
        activeMetric = data.primary_metric;
        dateColumn = data.date_column;

        selectedFilters = {};
        filterableColumns.forEach(col => {
            selectedFilters[col] = new Set(data.filters[col]);
        });

        emptyState.classList.add("hidden");
        topbarFileInfo.classList.add("visible");
        document.getElementById("current-filename").innerText = file.name;
        document.getElementById("results").classList.add("visible");
        document.getElementById("ai-insight-text").innerText = data.ai_summary;

        const sampleNote = document.getElementById("sample-note");
        sampleNote.innerText = data.sampled
            ? `Interactive view is based on a sample of ${data.records.length.toLocaleString()} of ${data.row_count.toLocaleString()} rows. Totals above reflect the full file.`
            : "";

        buildMetricSelector(data.numeric_columns, activeMetric);
        buildFilterPanel(data.filters);

        // Rebuild the whole dashboard shell only on a NEW file — this is where the entrance animation belongs
        dashboardBuilt = false;
        buildDashboardShell(rawData);
        dashboardBuilt = true;
    } catch (err) {
        alert("Something went wrong analyzing this file. Please try again.");
    } finally {
        btn.innerText = "Choose file";
        btn.disabled = false;
    }
}

function buildMetricSelector(numericColumns, current) {
    const select = document.getElementById("metric-select");
    select.innerHTML = "";
    numericColumns.forEach(col => {
        const option = document.createElement("option");
        option.value = col;
        option.innerText = col;
        if (col === current) option.selected = true;
        select.appendChild(option);
    });

    select.onchange = () => {
        activeMetric = select.value;
        updateDashboard(getFilteredData());
    };
}

function buildFilterPanel(filters) {
    const container = document.getElementById("filter-groups");
    container.innerHTML = "";

    if (filterableColumns.length === 0) {
        container.innerHTML = `<p class="no-filters">No filterable columns detected in this dataset.</p>`;
        return;
    }

    filterableColumns.forEach(col => {
        const group = document.createElement("div");
        group.className = "filter-group-block";

        const header = document.createElement("div");
        header.className = "filter-group-header";

        const title = document.createElement("span");
        title.innerText = col;

        const actions = document.createElement("div");
        actions.className = "filter-group-actions";

        const selectAllBtn = document.createElement("button");
        selectAllBtn.type = "button";
        selectAllBtn.innerText = "All";
        selectAllBtn.addEventListener("click", () => {
            selectedFilters[col] = new Set(filters[col]);
            syncCheckboxes(col);
            updateDashboard(getFilteredData());
        });

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.innerText = "None";
        clearBtn.addEventListener("click", () => {
            selectedFilters[col] = new Set();
            syncCheckboxes(col);
            updateDashboard(getFilteredData());
        });

        actions.appendChild(selectAllBtn);
        actions.appendChild(clearBtn);
        header.appendChild(title);
        header.appendChild(actions);
        group.appendChild(header);

        const list = document.createElement("div");
        list.className = "filter-checkbox-list";
        list.id = `filter-list-${col}`;

        filters[col].forEach(value => {
            const label = document.createElement("label");
            label.className = "filter-checkbox";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = true;
            checkbox.value = value;

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedFilters[col].add(value);
                } else {
                    selectedFilters[col].delete(value);
                }
                updateDashboard(getFilteredData());
            });

            const span = document.createElement("span");
            span.innerText = value;

            label.appendChild(checkbox);
            label.appendChild(span);
            list.appendChild(label);
        });

        group.appendChild(list);
        container.appendChild(group);
    });
}

function syncCheckboxes(col) {
    const list = document.getElementById(`filter-list-${col}`);
    const checkboxes = list.querySelectorAll("input[type=checkbox]");
    checkboxes.forEach(cb => {
        cb.checked = selectedFilters[col].has(cb.value);
    });
}

document.getElementById("reset-filters").addEventListener("click", () => {
    filterableColumns.forEach(col => {
        const list = document.getElementById(`filter-list-${col}`);
        if (!list) return;
        const checkboxes = list.querySelectorAll("input[type=checkbox]");
        selectedFilters[col] = new Set();
        checkboxes.forEach(cb => {
            cb.checked = true;
            selectedFilters[col].add(cb.value);
        });
    });
    updateDashboard(rawData);
});

function getFilteredData() {
    return rawData.filter(row => {
        return filterableColumns.every(col => selectedFilters[col].has(String(row[col])));
    });
}

function groupSum(records, col) {
    const grouped = {};
    records.forEach(row => {
        const key = row[col];
        grouped[key] = (grouped[key] || 0) + (Number(row[activeMetric]) || 0);
    });
    return grouped;
}

function buildDateSeries(records) {
    const byDate = {};
    records.forEach(row => {
        const raw = row[dateColumn];
        if (!raw || raw === "Unknown") return;
        byDate[raw] = (byDate[raw] || 0) + (Number(row[activeMetric]) || 0);
    });

    let entries = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));

    if (entries.length > 60) {
        const byMonth = {};
        entries.forEach(([date, val]) => {
            const month = date.slice(0, 7);
            byMonth[month] = (byMonth[month] || 0) + val;
        });
        entries = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
    }

    return entries;
}

/**
 * Builds every card and chart ONCE, right after a new file is uploaded.
 * This is the only place entrance animations happen.
 */
function buildDashboardShell(records) {
    const statRow = document.getElementById("stat-row");
    statRow.innerHTML = "";

    statRow.appendChild(makeStatCard("stat-total", `Total ${activeMetric}`));
    filterableColumns.slice(0, 2).forEach((col, i) => {
        statRow.appendChild(makeStatCard(`stat-top-${i}`, `Top ${col}`));
    });
    statRow.appendChild(makeStatCard("stat-rows", "Rows shown"));

    const chartGrid = document.getElementById("chart-grid");
    chartGrid.innerHTML = "";
    charts = {};

    if (dateColumn) {
        const card = buildVisualCard(`${activeMetric} over time`, "trendChart");
        chartGrid.appendChild(card);
        const ctx = document.getElementById("trendChart").getContext("2d");
        charts["trend"] = new Chart(ctx, {
            type: "line",
            data: { labels: [], datasets: [{
                label: activeMetric, data: [],
                borderColor: CHART_COLORS[0],
                backgroundColor: "rgba(245, 166, 35, 0.12)",
                fill: true, tension: 0.3, pointRadius: 2
            }]},
            options: {
                animation: ANIMATION,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false } }, y: { grid: { color: "#1C222C" } } }
            }
        });
    }

    if (filterableColumns[0]) {
        const col = filterableColumns[0];
        const card = buildVisualCard(`${activeMetric} share by ${col}`, `donutChart`);
        chartGrid.appendChild(card);
        const ctx = document.getElementById("donutChart").getContext("2d");
        charts["donut"] = new Chart(ctx, {
            type: "doughnut",
            data: { labels: [], datasets: [{ data: [], backgroundColor: CHART_COLORS, borderColor: "#151A22", borderWidth: 2 }] },
            options: {
                animation: ANIMATION,
                plugins: { legend: { position: "bottom", labels: { color: "#8B95A1", boxWidth: 10, font: { size: 11 } } } }
            }
        });
    }

    filterableColumns.slice(1, 4).forEach((col, i) => {
        const id = `barChart-${i}`;
        const card = buildVisualCard(`${activeMetric} by ${col}`, id);
        chartGrid.appendChild(card);
        const ctx = document.getElementById(id).getContext("2d");
        charts[`bar-${i}`] = new Chart(ctx, {
            type: "bar",
            data: { labels: [], datasets: [{ label: activeMetric, data: [], backgroundColor: CHART_COLORS[1], borderRadius: 4 }] },
            options: {
                animation: ANIMATION,
                plugins: { legend: { display: false } },
                scales: { x: { grid: { display: false } }, y: { grid: { color: "#1C222C" } } }
            }
        });
    });

    updateDashboard(records);
}

function makeStatCard(id, label) {
    const card = document.createElement("div");
    card.className = "stat-card animate-in";
    card.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value" id="${id}">—</span>`;
    return card;
}

function buildVisualCard(title, canvasId) {
    const card = document.createElement("div");
    card.className = "visual-card animate-in";
    card.innerHTML = `
        <div class="visual-header">
            <span class="visual-title" id="${canvasId}-title">${title}</span>
            <span class="visual-menu">⋯</span>
        </div>
        <div class="visual-body">
            <canvas id="${canvasId}"></canvas>
        </div>
    `;
    return card;
}

/**
 * Updates numbers/labels on EXISTING elements and chart instances — no DOM
 * removal, no re-animation, no flash. This runs on every filter/metric change.
 */
function updateDashboard(records) {
    const totalValue = records.reduce((sum, row) => sum + (Number(row[activeMetric]) || 0), 0);
    setStat("stat-total", formatNumber(totalValue));
    document.querySelector('label[for="stat-total"]');

    const statRow = document.getElementById("stat-row");
    statRow.children[0].querySelector(".stat-label").innerText = `Total ${activeMetric}`;

    filterableColumns.slice(0, 2).forEach((col, i) => {
        const grouped = groupSum(records, col);
        const keys = Object.keys(grouped);
        const topKey = keys.length ? keys.reduce((a, b) => grouped[a] > grouped[b] ? a : b) : "—";
        setStat(`stat-top-${i}`, topKey);
    });

    setStat("stat-rows", records.length.toLocaleString());

    if (dateColumn && charts["trend"]) {
        const entries = buildDateSeries(records);
        const chart = charts["trend"];
        chart.data.labels = entries.map(e => e[0]);
        chart.data.datasets[0].data = entries.map(e => e[1]);
        chart.data.datasets[0].label = activeMetric;
        document.getElementById("trendChart-title").innerText = `${activeMetric} over time`;
        chart.update();
    }

    if (filterableColumns[0] && charts["donut"]) {
        const col = filterableColumns[0];
        const grouped = groupSum(records, col);
        const chart = charts["donut"];
        chart.data.labels = Object.keys(grouped);
        chart.data.datasets[0].data = Object.values(grouped);
        document.getElementById("donutChart-title").innerText = `${activeMetric} share by ${col}`;
        chart.update();
    }

    filterableColumns.slice(1, 4).forEach((col, i) => {
        const chart = charts[`bar-${i}`];
        if (!chart) return;
        const grouped = groupSum(records, col);
        chart.data.labels = Object.keys(grouped);
        chart.data.datasets[0].data = Object.values(grouped);
        chart.data.datasets[0].label = activeMetric;
        document.getElementById(`barChart-${i}-title`).innerText = `${activeMetric} by ${col}`;
        chart.update();
    });
}

function setStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

function formatNumber(num) {
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

["dragenter", "dragover"].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragging");
    });
});

["dragleave", "drop"].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragging");
    });
});

dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (file) {
        analyzeFile(file);
    }
});