// ====================== 共用 ======================
const API_BASE = window.location.origin; // 例如 http://127.0.0.1:5000

let currentCompanyData = []; // 🆕 儲存目前公司所有年份的資料
let currentAverageData = {}; // 🆕 同產業平均也一起記住
let currentAverageByYear = []; // 🆕 各年度平均資料
let currentAverageOverall = {}; // 🆕 全期平均資料
// ===== 匯出報告需要的額外全域 =====
let AI_CACHE = { annual: {}, summary_5yr: "" }; // 儲存 AI 結果

// ====================== 行業比較用全域變數 ======================
let INDUSTRY_COMPARE_STATE = {
  industry1: null,
  industry2: null,
  year: null,
  lastIndicator: null,
};

let industryTrendChart = null; // 行業比較用的折線圖實例
// 行業比較結果暫存（給 AI 使用）
let LAST_INDUSTRY_COMPARE_DATA = null;
// 行業 AI 建議純文字快取
let INDUSTRY_AI_TEXT = "";

// 頁籤切換（頁面上方三個區塊）
const buttons = document.querySelectorAll(".switch-btn");
const sections = document.querySelectorAll(".content-section");
buttons.forEach(button => {
  button.addEventListener("click", () => {
    buttons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    const target = button.getAttribute("data-target");
    sections.forEach(section => section.classList.toggle("show", section.id === target));
  });
});

// 財報分類切換（財務結構／償債能力...）
const tabButtons = document.querySelectorAll(".tab-button");
const indicatorGroups = document.querySelectorAll(".indicator-group");
tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    tabButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    const targetId = button.getAttribute("data-target");
    indicatorGroups.forEach(group => group.classList.toggle("hidden", group.id !== targetId));
  });
});

// ====================== UI 小工具 ======================
function getLightClass(value, name, avgVal = null) {
  const v = Number(value);
  if (isNaN(v)) return "gray";

  // 🔸 統一處理
  const toPct = (num) => num * 100;

  // ===============================
  // 每個指標專屬判斷邏輯
  // ===============================
  switch (true) {
    // 🏦 財務結構
    case name.includes("負債占資產比率"):
      if (v < 0.3) return "green";
      if (v > 0.3 && v<0.5) return "yellow";
      return "red";

    case name.includes("長期資金占不動產") || name.includes("固定資產"):
      return v > 1 ? "green" : "red";

    // 💧 償債能力
    case name.includes("流動比率"):
      if (v > 2) return "green";
      if (v >= 1) return "yellow";
      return "red";

    case name.includes("速動比率"):
      if (v > 1) return "green";
      if (v >= 0.8) return "yellow";
      return "red";

    case name.includes("利息保障倍數"):
      if (v > 3) return "green";
      if (v >= 1) return "yellow";
      return "red";

    // 🔄 營運效率
    case name.includes("應收帳款週轉率"):
      return toPct(v) > 8 ? "green" : "red";

    case name.includes("不動產、廠房及設備週轉率"):
      if (avgVal == null) return "gray";
      return v < avgVal ? "green" : "red";

    case name.includes("存貨週轉率"):
      if (v < 0.16) return "green";
      if (v > 0.3) return "red";
      return "yellow";

    // 💰 獲利能力
    case name.includes("資產報酬率"):
      if (avgVal == null) return "gray";
      return v < avgVal ? "green" : "red";

    case name.includes("純益率"):
      if (v > 20) return "green";
      if (v >= 5 && v <= 15) return "yellow";
      if (v < 5) return "red";
      return "yellow";

    case name.includes("權益報酬率"):
      if (toPct(v) > 18) return "green";
      if (toPct(v) >= 8) return "yellow";
      return "red";

    case name.includes("每股盈餘"):
      if (v > 3) return "green";
      if (v >= 1) return "yellow";
      return "red";

    // 💵 現金流量
    case name.includes("現金流量比率") && !name.includes("允當"):
      if (v > 200) return "green";
      if (v >= 100) return "yellow";
      return "red";

    case name.includes("現金再投資比率"):
      if (v > 15) return "green";
      if (v >= 5) return "yellow";
      return "red";

    case name.includes("現金流量允當比率"):
      if (v > 150) return "green";
      if (v >= 100) return "yellow";
      return "red";

    // ⚙️ 槓桿度
    case name.includes("營運槓桿度"):
      if (v < 2) return "green";
      if (v <= 5) return "yellow";
      return "red";

    case name.includes("財務槓桿度"):
      if (v < 3) return "green";
      if (v >= 1.5 &&　v <= 3) return "yellow";
      return "red";

    default:
      return "gray";
  }
}

// ====================== 數值顯示格式 ======================
function toDisplay(value) {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "number") {
    // 若數值介於 -1 ~ 1，視為比例轉換為百分比
    if (Math.abs(value) < 1 && value !== 0) {
      return (value * 100).toFixed(1) + "%";
    }
    // 其餘顯示兩位小數
    return value.toFixed(2);
  }

  // 若是字串數字
  if (!isNaN(Number(value))) {
    const num = Number(value);
    if (Math.abs(num) < 1 && num !== 0) return (num * 100).toFixed(1) + "%";
    return num.toFixed(2);
  }

  return String(value);
}

// ====================== 後端資料 ======================
async function fetchIndicators(companyName) {
  const url = `${API_BASE}/get_indicator?company=${encodeURIComponent(companyName)}`;
  try {
    const res = await fetch(url);
    const text = await res.text(); // 先拿純文字以便 debug
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("後端返回的非 JSON：", text);
      alert("❌ 後端回傳格式不是 JSON，請查看瀏覽器 Console。");
      return;
    }

    if (!res.ok) {
      // 有回應但非 200，顯示後端的錯誤訊息
      console.error("API 錯誤", res.status, data);
      alert(data.error || `查詢失敗（HTTP ${res.status}）`);
      return;
    }

    currentCompanyData = data.data || [];
    currentAverageByYear = data.average_by_year || [];   // 🆕 年度平均
    currentAverageOverall = data.average_overall || {};  // 🆕 全期平均
    populateYearSelect(currentCompanyData);

    // 🆕 更新左上角公司名稱顯示
    if (data.data && data.data.length > 0) {
      const companyFullName = data.data[0]["公司"] || "";
      const titleEl = document.getElementById("stockName");
      titleEl.textContent = companyFullName;
    }

    renderIndicators(currentCompanyData, currentAverageData);
    renderAllYearAIAdvice(currentCompanyData); // 🆕 多年度 AI 分析

  } catch (err) {
    // 連線異常（連不到、CORS、被中斷）
    console.error("fetch 例外：", err);
    alert("❌ 無法連接後端伺服器，請確認 Flask 是否啟動。");
  }
}

// ====================== 年份選擇功能 ======================
function populateYearSelect(rows) {
  const select = document.getElementById("yearSelect");
  select.innerHTML = '<option value="">選擇年度</option>';

  if (!Array.isArray(rows) || rows.length === 0) return;

  // 🧮 從「年月」或「年份」欄位抽出純年份
  const years = [...new Set(rows.map(r => {
    if (r["年份"]) return String(r["年份"]);
    if (r["年月"]) return String(r["年月"]).slice(0, 4);
    return null;
  }))].filter(Boolean);

  years.sort();

  years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;        // 🔥 value 直接是年份，例如 "2018"
    opt.textContent = y;  // 顯示同樣的年份
    select.appendChild(opt);
  });

  // 綁定選擇事件
  select.onchange = () => {
    const y = select.value;
    let filtered = rows;
    if (y) {
      filtered = rows.filter(r => {
        const year = r["年份"] ? String(r["年份"]) : String(r["年月"]).slice(0, 4);
        return year === y;
      });
    }
    renderIndicators(filtered, currentAverageOverall);
};
}

// ====================== 渲染表格 ======================
function renderIndicators(rows, avgData = {}) {
  document.querySelectorAll(".indicator-table tbody").forEach(t => (t.innerHTML = ""));

  if (!Array.isArray(rows) || rows.length === 0) {
    const tb = document.querySelector("#finance tbody");
    tb.innerHTML = `<tr><td colspan="5">查無資料</td></tr>`;
    return;
  }

  const latest = rows[rows.length - 1];

  const buckets = {
    finance: ["負債占資產比率", "長期資金占不動產、廠房及設備比率"],
    debt: ["流動比率", "速動比率", "利息保障倍數"],
    operation: ["應收帳款週轉率", "不動產、廠房及設備週轉率", "存貨週轉率", "總資產週轉率"],
    profit: ["資產報酬率", "純益率", "權益報酬率", "每股盈餘"],
    cash: ["現金流量比率", "現金再投資比率", "現金流量允當比率 (%)"],
    leverage: ["營運槓桿度", "財務槓桿度"]
  };

  Object.entries(buckets).forEach(([groupId, cols]) => {
    const tbody = document.querySelector(`#${groupId} tbody`);
    if (!tbody) return;

    cols.forEach(name => {
      const val = latest[name];

      // 🔍 抓選取年份
      const select = document.getElementById("yearSelect");
      const selectedYear = select && select.value ? String(select.value) : null;

      let avgVal = null;

      // 🎯 若選了年份，找年度平均
      if (selectedYear && Array.isArray(currentAverageByYear)) {
        const match = currentAverageByYear.find(r => String(r["年月"]).slice(0, 4) === selectedYear);
        if (match && match[name] !== undefined) {
          avgVal = match[name];
        }
      }

      // 若沒找到，就顯示全期平均
      if (avgVal === null && currentAverageOverall) {
        avgVal = currentAverageOverall[name] || null;
      }

      const row = `
        <tr>
          <td>${name}</td>
          <td>${toDisplay(val)}</td>
          <td><span class="dot ${getLightClass(val, name, avgVal)}"></span></td>
          <td>${toDisplay(avgVal)}</td>
          <td><button class="trend-btn">查看趨勢</button></td>
        </tr>`;
      tbody.insertAdjacentHTML("beforeend", row);
    });
  });

  // 綁定趨勢按鈕
  document.querySelectorAll(".trend-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const indicatorName = e.target.closest("tr").children[0].textContent.trim();
      renderTrendChart(indicatorName);
    });
  });
}

// ====================== 搜尋 ======================
async function searchStock() {
  const inputEl = document.getElementById("stockInput");
  const titleEl = document.getElementById("stockName");
  let q = (inputEl.value || "").trim();
  if (!q) {
    alert("請輸入公司名稱或代碼");
    return;
  }
  // 清理：移除單引號與空白，避免 '1471 首利 這類輸入
  q = q.replace(/'/g, "").replace(/\s+/g, "");
  
  await fetchIndicators(q);
}

// 頁面載入預設查一次
// ====================== 折線趨勢圖 ======================
let trendChart = null; // 🆕 全域變數用來保存圖表實例，避免重疊

function renderTrendChart(indicatorName) {
  const ctx = document.getElementById("trendChart").getContext("2d");

  if (!currentCompanyData || currentCompanyData.length === 0) {
    alert("請先搜尋公司資料！");
    return;
  }

  // 取得年份欄位（可能是 年份 或 年月）
  const yearKey = currentCompanyData[0].hasOwnProperty("年份") ? "年份" : "年月";

  // 排序資料（依年份遞增）
  const sorted = [...currentCompanyData].sort((a, b) => (a[yearKey] > b[yearKey] ? 1 : -1));

  // 準備 X 軸（年份）與 Y 軸（該指標值）
  const labels = sorted.map(r => r[yearKey]);
  const companyValues = sorted.map(r => r[indicatorName]);
  const avgValue = currentAverageData ? currentAverageData[indicatorName] : null;
  const avgValues = Array(sorted.length).fill(avgValue);

  // 若已有舊圖表，先銷毀避免疊圖
  if (trendChart) {
    trendChart.destroy();
  }

  // 建立新圖表
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
  // 🔵 公司每年數值
        {
          label: `(${sorted[0]["公司"]}) ${indicatorName}`,
          data: companyValues,
          borderColor: "rgba(54, 162, 235, 1)",
          backgroundColor: "rgba(54, 162, 235, 0.2)",
          fill: false,
          tension: 0.3,
          pointRadius: 4
        },
  // 🔴 年度平均（虛線）
        {
          label: "同產業年度平均",
          data: labels.map(y => {
            const match = currentAverageByYear.find(r => String(r["年月"]) === String(y));
            return match ? match[indicatorName] : null;
        }),
          borderColor: "rgba(255, 99, 132, 1)",
          backgroundColor: "rgba(255, 99, 132, 0.1)",
          fill: false,
          borderDash: [6, 4],
          tension: 0.3,
          pointRadius: 3
        },
  // ⚫ 全期平均（水平虛線）
        {
          label: "全期產業平均",
          data: Array(labels.length).fill(currentAverageOverall[indicatorName] || null),
          borderColor: "rgba(0, 0, 0, 0.8)",
          backgroundColor: "rgba(0, 0, 0, 0.1)",
          fill: false,
          borderDash: [4, 4],
          tension: 0.3,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top" },
        title: { display: true, text: `${indicatorName} 歷年趨勢圖` },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              const val = ctx.parsed.y;
              if (Math.abs(val) < 1) return `${ctx.dataset.label}: ${(val * 100).toFixed(1)}%`;
              return `${ctx.dataset.label}: ${val.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "年度" }
        },
        y: {
          title: { display: true, text: indicatorName },
          beginAtZero: false
        }
      }
    }
  });

  // 滑動到圖表區域
  const chartSection = document.querySelector(".chart-section");
  if (chartSection) chartSection.scrollIntoView({ behavior: "smooth" });
}

// ====================== 行業比較：載入行業清單 ======================
function loadIndustryList() {
  fetch(`${API_BASE}/industry_list`)
    .then(res => res.json())
    .then(data => {
      const industries = data.industries || [];
      const sel1 = document.getElementById("industrySelect1");
      const sel2 = document.getElementById("industrySelect2");
      if (!sel1 || !sel2) return;

      // 保留第一個「請選擇」，清掉後面
      sel1.length = 1;
      sel2.length = 1;

      industries.forEach(name => {
        const opt1 = document.createElement("option");
        opt1.value = name;
        opt1.textContent = name;
        sel1.appendChild(opt1);

        const opt2 = document.createElement("option");
        opt2.value = name;
        opt2.textContent = name;
        sel2.appendChild(opt2);
      });
    })
    .catch(err => {
      console.error("載入行業清單失敗", err);
    });
}

// ====================== 行業比較：按下「開始行業比較」 ======================
function setupIndustryCompare() {
  const btn = document.getElementById("btnStartIndustryCompare");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const industry1 = document.getElementById("industrySelect1").value;
    const industry2 = document.getElementById("industrySelect2").value;
    const year = document.getElementById("industryYearSelect").value;

    if (!industry1 || !industry2) {
      alert("請選擇兩個行業");
      return;
    }
    if (industry1 === industry2) {
      alert("請選擇不同的兩個行業做比較");
      return;
    }
    if (!year) {
      alert("請選擇年份");
      return;
    }

    INDUSTRY_COMPARE_STATE.industry1 = industry1;
    INDUSTRY_COMPARE_STATE.industry2 = industry2;
    INDUSTRY_COMPARE_STATE.year = year;

    fetch(`${API_BASE}/industry_compare?industry1=${encodeURIComponent(industry1)}&industry2=${encodeURIComponent(industry2)}&year=${encodeURIComponent(year)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          alert(data.error);
          return;
        }
        // 🆕 把這次比較的結果暫存起來，給 AI 使用
        LAST_INDUSTRY_COMPARE_DATA = data;

        renderIndustryCompareTable(data);
        setupIndustryTabs();  // 初始化分類 tab

        // 預設顯示第一個指標的趨勢圖
        if (data.indicators && data.indicators.length > 0) {
          showIndustryTrend(data.indicators[0].name);
        }
      })
      .catch(err => {
        console.error("行業比較失敗", err);
        alert("行業比較時發生錯誤");
      });
  });
}

// 行業比較的指標分類（跟財報分析分類一致）
const INDUSTRY_INDICATOR_BUCKETS = {
  finance: ["負債占資產比率", "長期資金占不動產、廠房及設備比率"],
  debt: ["流動比率", "速動比率", "利息保障倍數"],
  operation: ["應收帳款週轉率", "不動產、廠房及設備週轉率", "存貨週轉率", "總資產週轉率"],
  profit: ["資產報酬率", "純益率", "權益報酬率", "每股盈餘"],
  cash: ["現金流量比率", "現金再投資比率", "現金流量允當比率 (%)"],
  leverage: ["營運槓桿度", "財務槓桿度"]
};

function renderIndustryCompareTable(data) {
  const resultDiv = document.getElementById("industryCompareResult");
  const titleEl = document.getElementById("industryCompareTitle");

  if (!resultDiv) return;

  // 標題
  titleEl.textContent = `${data.year} 年「${data.industry1}」與「${data.industry2}」行業平均值比較`;

  // 把行業比較區裡所有表格的第 2、3 欄表頭都改成行業名稱
  const headerRows = document.querySelectorAll("#industryCompareResult table thead tr");
  headerRows.forEach(row => {
    const ths = row.querySelectorAll("th");
    // th[0] = 指標名稱, th[1] = 行業一, th[2] = 行業一等級,
    // th[3] = 行業二, th[4] = 行業二等級, th[5] = 趨勢圖
    if (ths.length >= 4) {
      ths[1].textContent = data.industry1;
      ths[3].textContent = data.industry2;
    }
  });


  // 先清空六個分類的 tbody
  Object.keys(INDUSTRY_INDICATOR_BUCKETS).forEach(key => {
    const tbody = document.querySelector(`#industryTable-${key} tbody`);
    if (tbody) tbody.innerHTML = "";
  });

  // 依照指標名稱把資料塞進對應分類
  (data.indicators || []).forEach(ind => {
    // 找這個指標屬於哪一個分類
    let bucketKey = null;
    for (const [key, list] of Object.entries(INDUSTRY_INDICATOR_BUCKETS)) {
      if (list.includes(ind.name)) {
        bucketKey = key;
        break;
      }
    }
    if (!bucketKey) bucketKey = "finance";

    const tbody = document.querySelector(`#industryTable-${bucketKey} tbody`);
    if (!tbody) return;

    const tr = document.createElement("tr");

    // 指標名稱
    const tdName = document.createElement("td");
    tdName.textContent = ind.name;

    // 行業一數值
    const tdVal1 = document.createElement("td");
    tdVal1.textContent = ind.industry1 == null ? "-" : toDisplay(ind.industry1);

    // 行業一等級判斷（紅綠燈）
    const tdLight1 = document.createElement("td");
    const span1 = document.createElement("span");
    span1.classList.add("dot", getLightClass(ind.industry1, ind.name, ind.industry2));
    tdLight1.appendChild(span1);

    // 行業二數值
    const tdVal2 = document.createElement("td");
    tdVal2.textContent = ind.industry2 == null ? "-" : toDisplay(ind.industry2);

    // 行業二等級判斷（紅綠燈）
    const tdLight2 = document.createElement("td");
    const span2 = document.createElement("span");
    span2.classList.add("dot", getLightClass(ind.industry2, ind.name, ind.industry1));
    tdLight2.appendChild(span2);

    // 查看趨勢按鈕
    const tdAction = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "查看趨勢";
    btn.addEventListener("click", () => {
      showIndustryTrend(ind.name);
    });
    tdAction.appendChild(btn);

    // 欄位順序：指標名稱｜行業一｜行業一燈號｜行業二｜行業二燈號｜趨勢圖
    tr.appendChild(tdName);
    tr.appendChild(tdVal1);
    tr.appendChild(tdLight1);
    tr.appendChild(tdVal2);
    tr.appendChild(tdLight2);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  });


  // 顯示區塊
  resultDiv.style.display = "block";

  // 預設顯示「財務結構」分頁
  const groups = document.querySelectorAll(".industry-group");
  groups.forEach(g => g.classList.add("hidden"));
  const firstGroup = document.getElementById("industryGroup-finance");
  if (firstGroup) firstGroup.classList.remove("hidden");

  const tabs = document.querySelectorAll(".industry-tab-button");
  tabs.forEach(t => t.classList.remove("active"));
  if (tabs.length > 0) tabs[0].classList.add("active");
}

// 行業比較：分類標籤切換
// 行業比較：分類標籤切換
function setupIndustryTabs() {
  const tabs = document.querySelectorAll(".industry-tab-button");
  const groups = document.querySelectorAll(".industry-group");
  if (!tabs.length || !groups.length) return;

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");

      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      groups.forEach(g => {
        if (g.id === targetId) {
          g.classList.remove("hidden");
        } else {
          g.classList.add("hidden");
        }
      });
    });
  });
}


// ====================== 行業比較：呼叫後端取得趨勢資料 ======================
function showIndustryTrend(indicatorName) {
  const { industry1, industry2 } = INDUSTRY_COMPARE_STATE;
  if (!industry1 || !industry2) return;

  INDUSTRY_COMPARE_STATE.lastIndicator = indicatorName;

  fetch(`${API_BASE}/industry_trend?industry1=${encodeURIComponent(industry1)}&industry2=${encodeURIComponent(industry2)}&indicator=${encodeURIComponent(indicatorName)}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        alert(data.error);
        return;
      }
      renderIndustryTrendChart(data);
    })
    .catch(err => {
      console.error("取得行業趨勢失敗", err);
      alert("載入行業趨勢時發生錯誤");
    });
}

// ====================== 行業比較：畫折線圖 ======================
function renderIndustryTrendChart(data) {
  const area = document.getElementById("industryTrendArea");
  const titleEl = document.getElementById("industryTrendTitle");
  const canvas = document.getElementById("industryTrendChart");
  if (!area || !titleEl || !canvas) return;

  const ctx = canvas.getContext("2d");
  const years = data.industry1.years;
  const values1 = data.industry1.values;
  const values2 = data.industry2.values;

  titleEl.textContent = `${data.indicator} – ${data.industry1.name} vs ${data.industry2.name} 行業趨勢比較折線圖 (10年份)`;

  if (industryTrendChart) {
    industryTrendChart.destroy();
  }

  industryTrendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: years,
      datasets: [
        {
          label: data.industry1.name,
          data: values1,
          fill: false,
          tension: 0.1
        },
        {
          label: data.industry2.name,
          data: values2,
          fill: false,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { position: "top" },
        tooltip: { enabled: true }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "年份"
          }
        },
        y: {
          title: {
            display: true,
            text: data.indicator
          },
          beginAtZero: false
        }
      }
    }
  });

  area.style.display = "block";
  // 👉 按下「查看趨勢」後，自動捲動到行業折線圖
  area.scrollIntoView({ behavior: "smooth" });
}

// ====================== 🧠 生成單一行業指標折線圖（用於 行業 Word 匯出） ======================
async function buildIndustryTrendChartImage(indicatorName) {
  const { industry1, industry2 } = INDUSTRY_COMPARE_STATE;
  if (!industry1 || !industry2) return null;

  try {
    const res = await fetch(
      `${API_BASE}/industry_trend?industry1=${encodeURIComponent(industry1)}&industry2=${encodeURIComponent(industry2)}&indicator=${encodeURIComponent(indicatorName)}`
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      console.error("取得行業趨勢失敗（產圖）:", indicatorName, data.error);
      return null;
    }

    const years = data.industry1.years || [];
    const values1 = data.industry1.values || [];
    const values2 = data.industry2.values || [];

    // 建立離線 canvas
    const canvas = document.createElement("canvas");
    canvas.width = 1100;
    canvas.height = 500;
    const ctx = canvas.getContext("2d");

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: years,
        datasets: [
          {
            label: data.industry1.name,
            data: values1,
            borderColor: "rgba(54, 162, 235, 1)",
            backgroundColor: "rgba(54, 162, 235, 0.15)",
            fill: false,
            tension: 0.25,
            pointRadius: 3
          },
          {
            label: data.industry2.name,
            data: values2,
            borderColor: "rgba(255, 99, 132, 1)",
            backgroundColor: "rgba(255, 99, 132, 0.15)",
            fill: false,
            tension: 0.25,
            pointRadius: 3
          }
        ]
      },
      options: {
        responsive: false,
        plugins: {
          legend: { position: "top" },
          title: { display: true, text: `${indicatorName} – 行業趨勢比較` }
        },
        scales: {
          x: {
            title: { display: true, text: "年份" }
          },
          y: {
            title: { display: true, text: indicatorName },
            beginAtZero: false
          }
        }
      }
    });

    // 給 Chart.js 一點時間 render
    await new Promise(r => setTimeout(r, 100));
    const img = canvas.toDataURL("image/png");
    chart.destroy();
    return img;
  } catch (err) {
    console.error("buildIndustryTrendChartImage 例外：", indicatorName, err);
    return null;
  }
}


// ====================== 行業比較：整理 2015–2024 趨勢資料給 AI ======================
async function buildIndustryYearsDataForAI() {
  const { industry1, industry2 } = INDUSTRY_COMPARE_STATE;
  if (!industry1 || !industry2) {
    throw new Error("尚未選擇行業一與行業二");
  }

  // 所有要看的指標名稱：沿用 INDUSTRY_INDICATOR_BUCKETS
  const allIndicators = [...new Set(Object.values(INDUSTRY_INDICATOR_BUCKETS).flat())];

  const yearMap = {}; // { "2015": {year:2015, industry1:{}, industry2:{}} ... }

  // 一次抓完所有指標的趨勢
  const fetchPromises = allIndicators.map(name =>
    fetch(
      `${API_BASE}/industry_trend?industry1=${encodeURIComponent(industry1)}&industry2=${encodeURIComponent(industry2)}&indicator=${encodeURIComponent(name)}`
    )
      .then(res => res.json())
      .then(data => ({ name, data }))
      .catch(err => {
        console.error("取得行業趨勢失敗：", name, err);
        return null; // 某些指標失敗就略過
      })
  );

  const results = await Promise.all(fetchPromises);

  results.forEach(item => {
    if (!item || item.data.error) return;
    const { name, data } = item;
    const years = data.industry1.years || [];
    const v1 = data.industry1.values || [];
    const v2 = data.industry2.values || [];

    years.forEach((y, idx) => {
      const yearStr = String(y).slice(0, 4); // 2015 或 2015-01-01 都可以
      if (!yearMap[yearStr]) {
        yearMap[yearStr] = {
          year: Number(yearStr),
          industry1: {},
          industry2: {}
        };
      }
      const val1 = v1[idx];
      const val2 = v2[idx];
      if (val1 !== null && val1 !== undefined) {
        yearMap[yearStr].industry1[name] = val1;
      }
      if (val2 !== null && val2 !== undefined) {
        yearMap[yearStr].industry2[name] = val2;
      }
    });
  });

  // 轉成排序後的陣列（例如 2015 ~ 2024）
  const years_data = Object.values(yearMap).sort((a, b) => a.year - b.year);
  return years_data;
}


// ====================== 🧠 多年度 AI 建議（2015–2024 + 五年整體分析） ======================
async function renderAllYearAIAdvice(allRows) {
  const box = document.getElementById("aiAdvice");

  if (!Array.isArray(allRows) || allRows.length === 0) {
    box.innerHTML = "請輸入股票代碼後顯示建議。";
    return;
  }

  const company = allRows[0]["公司"] || "未命名公司";
  box.innerHTML = `💭 <em>AI 正在分析 ${company} 2015–2024 年的財務資料，請稍候...</em>`;

  try {
    const res = await fetch(`${API_BASE}/chatgpt_multi_advice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company,
        all_years: allRows
      })
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.annual) {
      box.innerHTML = "";
      Object.entries(data.annual).forEach(([year, advice]) => {
        const html = `
          <div class="ai-advice-block" style="margin-bottom:10px;">
            <h3>💡 AI 財務分析建議（${year} 年）</h3>
            <p><strong>公司：</strong>${company}</p>
            <p style="margin-top:6px; line-height:1.6;">
              ${advice.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>").trim()}
            </p>
          </div>`;
        box.insertAdjacentHTML("beforeend", html);
      });

      if (data.summary_5yr) {
        box.insertAdjacentHTML("beforeend", `
          <div class="ai-advice-block" style="background:#fffbe6;">
            <h3>📈 最新前五年 AI 財務分析整體建議（2020–2024）</h3>
            <p style="line-height:1.6;">
              ${data.summary_5yr.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>").trim()}
            </p>
          </div>`);
      }

      // ✅ 快取結果供匯出報告使用
      AI_CACHE.annual = data.annual || {};
      AI_CACHE.summary_5yr = data.summary_5yr || "";

    } else {
      box.innerHTML = `❌ 無法取得多年度 AI 建議。<br>錯誤：${data.error || "未知"}`;
      console.error("AI API 錯誤：", data);
    }

  } catch (err) {
    console.error("fetch /chatgpt_multi_advice 例外:", err);
    box.innerHTML = `❌ 無法取得多年度 AI 建議，請稍後再試。<br>${err.message}`;
  }
}

// ====================== 📤 匯出「行業比較」報告 ======================
const btnExportIndustry = document.getElementById("exportIndustryReport");
if (btnExportIndustry) {
  btnExportIndustry.addEventListener("click", async () => {
    const { industry1, industry2, year } = INDUSTRY_COMPARE_STATE;

    if (!industry1 || !industry2 || !year) {
      alert("請先選擇行業一、行業二與年份，並按下「開始行業比較」。");
      return;
    }

    // 1️⃣ 收集所有指標摘要（從行業比較表格抓）
    const indicators_summary = [];
    document
      .querySelectorAll("#industryCompareResult tbody tr")
      .forEach(tr => {
        const tds = tr.querySelectorAll("td");
        // 指標名稱｜行業一｜行業一燈號｜行業二｜行業二燈號｜趨勢圖
        if (tds.length < 5) return;

        const name = tds[0].textContent.trim();
        const value1 = tds[1].textContent.trim();
        const value2 = tds[3].textContent.trim();

        const dot1 = tds[2].querySelector(".dot");
        const dot2 = tds[4].querySelector(".dot");
        let light1 = "gray";
        let light2 = "gray";

        if (dot1) {
          if (dot1.classList.contains("green")) light1 = "green";
          else if (dot1.classList.contains("yellow")) light1 = "yellow";
          else if (dot1.classList.contains("red")) light1 = "red";
        }
        if (dot2) {
          if (dot2.classList.contains("green")) light2 = "green";
          else if (dot2.classList.contains("yellow")) light2 = "yellow";
          else if (dot2.classList.contains("red")) light2 = "red";
        }

        indicators_summary.push({
          name,
          value1,
          light1,
          value2,
          light2
        });
      });

    if (!indicators_summary.length) {
      alert("目前沒有行業比較資料，請先按「開始行業比較」。");
      return;
    }

    // 2️⃣ 產生所有指標的行業折線圖（10 年份）
    const charts = [];
    const allIndicators = [...new Set(Object.values(INDUSTRY_INDICATOR_BUCKETS).flat())];

    for (const name of allIndicators) {
      const img = await buildIndustryTrendChartImage(name);
      if (img) {
        charts.push({
          title: `${name} – 行業趨勢圖`,
          img_base64: img
        });
      }
    }

    // 3️⃣ 行業 AI 建議純文字（如果沒按 AI 按鈕，就抓目前區塊的文字）
    let ai_text = INDUSTRY_AI_TEXT;
    if (!ai_text) {
      const adviceBox = document.getElementById("industryAiAdvice");
      if (adviceBox) {
        ai_text = adviceBox.innerText || adviceBox.textContent || "";
      }
    }

    // 4️⃣ 丟給後端產生 Word 報告
    try {
      const res = await fetch(`${API_BASE}/export_industry_report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry1,
          industry2,
          compare_year: year,
          indicators_summary,
          charts,
          ai_text
        })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.word) {
        alert("✅ 行業比較報告已生成！");
        window.open(`${API_BASE}/${data.word}`, "_blank");
      } else {
        alert("❌ 行業比較報告匯出失敗：" + (data.error || "未知錯誤"));
      }
    } catch (err) {
      console.error("匯出行業比較報告錯誤：", err);
      alert("❌ 匯出行業比較報告時發生錯誤：" + err.message);
    }
  });
}


// ====================== 📤 匯出報告功能（新增年度篩選） ======================

// 🧩 全部指標清單（用於產圖）
const INDICATOR_BUCKETS = {
  finance: ["負債占資產比率", "長期資金占不動產、廠房及設備比率"],
  debt: ["流動比率", "速動比率", "利息保障倍數"],
  operation: ["應收帳款週轉率", "不動產、廠房及設備週轉率", "存貨週轉率", "總資產週轉率"],
  profit: ["資產報酬率", "純益率", "權益報酬率", "每股盈餘"],
  cash: ["現金流量比率", "現金再投資比率", "現金流量允當比率 (%)"],
  leverage: ["營運槓桿度", "財務槓桿度"]
};

// 🧠 生成單一指標折線圖（用於 Word 匯出）
async function buildTrendChartImage(indicatorName) {
  if (!currentCompanyData || currentCompanyData.length === 0) return null;
  const yearKey = currentCompanyData[0].hasOwnProperty("年份") ? "年份" : "年月";
  const sorted = [...currentCompanyData].sort((a, b) => (a[yearKey] > b[yearKey] ? 1 : -1));
  const labels = sorted.map(r => r[yearKey]);
  const companyValues = sorted.map(r => r[indicatorName]);
  const byYear = labels.map(y => {
    const yy = String(y).slice(0, 4);
    const match = currentAverageByYear.find(r => String(r["年月"]).slice(0, 4) === yy);
    return match ? match[indicatorName] : null;
  });
  const overall = currentAverageOverall[indicatorName] || null;
  const overallArr = Array(labels.length).fill(overall);

  const canvas = document.createElement("canvas");
  canvas.width = 1100;
  canvas.height = 500;
  const ctx = canvas.getContext("2d");

  const chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `(${sorted[0]["公司"]}) ${indicatorName}`,
          data: companyValues,
          borderColor: "rgba(54, 162, 235, 1)",
          fill: false,
          tension: 0.3
        },
        {
          label: "同產業年度平均",
          data: byYear,
          borderColor: "rgba(255, 99, 132, 1)",
          borderDash: [6, 4],
          fill: false,
          tension: 0.3
        },
        {
          label: "全期產業平均",
          data: overallArr,
          borderColor: "rgba(0, 0, 0, 0.8)",
          borderDash: [4, 4],
          fill: false
        }
      ]
    },
    options: { responsive: false, plugins: { legend: { position: "top" } } }
  });

  await new Promise(r => setTimeout(r, 100));
  const img = canvas.toDataURL("image/png");
  chart.destroy();
  return img;
}

// ====================== 行業比較 AI 建議 ======================
const btnIndustryAI = document.getElementById("btnIndustryAI");
if (btnIndustryAI) {
  btnIndustryAI.addEventListener("click", async () => {
    const adviceBox = document.getElementById("industryAiAdvice");
    const { industry1, industry2 } = INDUSTRY_COMPARE_STATE;

    if (!industry1 || !industry2) {
      alert("請先選擇行業一與行業二，並按下「開始行業比較」。");
      return;
    }
    if (!LAST_INDUSTRY_COMPARE_DATA) {
      alert("請先完成一次行業比較後，再產生 AI 建議。");
      return;
    }

    adviceBox.innerHTML = `💭 <em>AI 正在分析 ${industry1} 與 ${industry2} 2015–2024 年的財務趨勢，請稍候...</em>`;

    try {
      const years_data = await buildIndustryYearsDataForAI();
      if (!years_data.length) {
        adviceBox.innerHTML = "❌ 找不到足夠的年度資料，無法產生 AI 建議。";
        return;
      }

      const res = await fetch(`${API_BASE}/chatgpt_industry_advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry1,
          industry2,
          years_data
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        console.error("行業 AI 建議錯誤：", data);
        adviceBox.innerHTML = `❌ 無法取得行業 AI 建議：${data.error || "未知錯誤"}`;
        return;
      }

      const pureText = data.text || "";

      // 將換行轉成 <br> 顯示
      adviceBox.innerHTML = (data.text || "")
        .replace(/\n{2,}/g, "<br><br>")
        .replace(/\n/g, "<br>");

// 🆕 把原始文字快取起來，給匯出報告使用
      INDUSTRY_AI_TEXT = pureText;

    } catch (err) {
      console.error("行業 AI 建議例外：", err);
      adviceBox.innerHTML = `❌ 產生行業 AI 建議時發生錯誤：${err.message}`;
    }
  });
}


// ====================== 📤 匯出報告 ======================
document.getElementById("exportReport").addEventListener("click", async () => {
  const company = document.getElementById("stockName").textContent.trim() || "未命名公司";

  // ✅ 抓取目前選擇的年份
  const selectedYear = document.getElementById("yearSelect").value || "";

  // 1️⃣ 收集指標摘要
  const indicators_summary = [];
  document.querySelectorAll("#section-financial .indicator-table tbody tr").forEach(tr => {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) return;
    const name = tds[0].textContent.trim();
    const value = tds[1].textContent.trim();
    const avg = tds[3].textContent.trim();
    const dot = tds[2].querySelector(".dot");
    let light = "gray";
    if (dot) {
      if (dot.classList.contains("green")) light = "green";
      else if (dot.classList.contains("yellow")) light = "yellow";
      else if (dot.classList.contains("red")) light = "red";
    }
    indicators_summary.push({ name, value, avg, light });
  });

  // 2️⃣ 產生所有指標的折線圖
  const charts = [];
  const allIndicators = Object.values(INDICATOR_BUCKETS).flat();
  for (const name of allIndicators) {
    const img = await buildTrendChartImage(name);
    if (img) charts.push({ title: `${name} 趨勢圖`, img_base64: img });
  }

  // 3️⃣ 整理 AI 建議（僅選擇的年度）
  const ai_annual = {};
  if (selectedYear && AI_CACHE.annual[selectedYear]) {
    ai_annual[selectedYear] = AI_CACHE.annual[selectedYear];
  }

  // 4️⃣ 傳給後端
  try {
    const res = await fetch(`${API_BASE}/export_report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company,
        selected_year: selectedYear,
        indicators_summary,
        charts,
        ai_annual,
        ai_summary_5yr: AI_CACHE.summary_5yr || ""
      })
    });

    const data = await res.json();
    if (res.ok && data.word) {
      alert("✅ 報告已生成！");
      window.open(`${API_BASE}/${data.word}`, "_blank");
    } else {
      alert("❌ 匯出失敗：" + (data.error || "未知錯誤"));
    }
  } catch (err) {
    console.error("匯出報告錯誤：", err);
    alert("❌ 匯出報告時發生錯誤：" + err.message);
  }
});

// ====================== 📤 匯出「行業比較」Word 報告 ======================
const btnExportIndustryReport = document.getElementById("btnExportIndustryReport");
if (btnExportIndustryReport) {
  btnExportIndustryReport.addEventListener("click", async () => {
    const { industry1, industry2, year } = INDUSTRY_COMPARE_STATE;

    if (!industry1 || !industry2 || !year) {
      alert("請先完成行業比較（選好行業一、行業二與年份，並按下「開始行業比較」）再匯出報告。");
      return;
    }

    // 1️⃣ 從畫面上的行業比較表格，抓取所有指標資料
    const indicators = [];
    // 抓所有行業比較的 tbody 裡的列（六大分類加起來）
    document.querySelectorAll("#industryCompareResult tbody tr").forEach(tr => {
      const tds = tr.querySelectorAll("td");
      // 欄位順序：指標名稱｜行業一｜行業一燈號｜行業二｜行業二燈號｜趨勢圖按鈕
      if (tds.length < 5) return;

      const name = tds[0].textContent.trim();
      const industry1_value = tds[1].textContent.trim();
      const industry2_value = tds[3].textContent.trim();

      // 行業一燈號
      let industry1_light = "gray";
      const dot1 = tds[2].querySelector(".dot");
      if (dot1) {
        if (dot1.classList.contains("green")) industry1_light = "green";
        else if (dot1.classList.contains("yellow")) industry1_light = "yellow";
        else if (dot1.classList.contains("red")) industry1_light = "red";
      }

      // 行業二燈號
      let industry2_light = "gray";
      const dot2 = tds[4].querySelector(".dot");
      if (dot2) {
        if (dot2.classList.contains("green")) industry2_light = "green";
        else if (dot2.classList.contains("yellow")) industry2_light = "yellow";
        else if (dot2.classList.contains("red")) industry2_light = "red";
      }

      indicators.push({
        name,
        industry1_value,
        industry1_light,
        industry2_value,
        industry2_light,
      });
    });

    if (!indicators.length) {
      alert("找不到行業指標比較資料，請確認「行業比較」區塊有顯示表格。");
      return;
    }

    // 2️⃣ 產生所有指標的行業趨勢折線圖（用來塞進 Word）
    const charts = [];
    const allIndicators = [...new Set(Object.values(INDUSTRY_INDICATOR_BUCKETS).flat())];
    for (const indicatorName of allIndicators) {
      const img = await buildIndustryTrendChartImage(indicatorName);
      if (img) {
        charts.push({
          title: `${indicatorName} – 行業趨勢比較`,
          img_base64: img,
        });
      }
    }

    // 3️⃣ 行業 AI 建議（文字）：直接用之前快取好的 INDUSTRY_AI_TEXT
    const ai_text = INDUSTRY_AI_TEXT || "";

    // 4️⃣ 組成要送給後端的 payload
    const payload = {
      industry1,
      industry2,
      year,
      indicators,
      charts,
      ai_text,
    };

    try {
      const res = await fetch(`${API_BASE}/export_industry_report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.word) {
        alert("✅ 行業比較報告已生成！");
        // 🔥 這行會讓瀏覽器開啟 / 下載檔案，到使用者預設下載資料夾
        window.open(`${API_BASE}/${data.word}`, "_blank");
      } else {
        alert("❌ 匯出行業比較報告失敗：" + (data.error || "未知錯誤"));
      }
    } catch (err) {
      console.error("匯出行業比較報告錯誤：", err);
      alert("❌ 匯出行業比較報告時發生錯誤：" + err.message);
    }
  });
}


// ====================== 初始化行業比較功能 ======================
loadIndustryList();
setupIndustryCompare();


