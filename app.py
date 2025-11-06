from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import pandas as pd
import traceback
import os
# === OpenAI 客製化：讀取 API Key 並建立 client ===
from openai import OpenAI
from dotenv import load_dotenv  # ✅ 若有 .env 可自動讀取

load_dotenv()  # ✅ 會自動讀取 .env 檔（可放 OPENAI_API_KEY）

# ✅ 正確方式：從環境變數讀取，不要放整段 key 名稱
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # ← 環境變數名稱是 OPENAI_API_KEY
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ✅ 防呆：有設定就建立 client，否則提示錯誤
if OPENAI_API_KEY:
    client = OpenAI(api_key=OPENAI_API_KEY)
    print("✅ 已載入 OPENAI_API_KEY，模型：", OPENAI_MODEL)
else:
    client = None
    print("❌ 未偵測到 OPENAI_API_KEY！請確認環境變數或 .env 已設定。")

# ----------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE_DIR, static_url_path='')
CORS(app)


EXCEL_PATH = os.path.join(BASE_DIR, "財務指標輸出.xlsx")

# 啟動時就讀檔，讀不到會直接在 Console 顯示錯誤
try:
    df = pd.read_excel(EXCEL_PATH)

# 🆕 分出不同類型資料
    avg_df = df[df["公司"].astype(str).str.contains("平均值")].copy()
    company_df = df[~df["公司"].astype(str).str.contains("平均值")].copy()

# 🆕 分出各年度平均與全期平均
    avg_by_year_df = avg_df[avg_df["公司"].astype(str).str.match(r"^\d{4} 平均值$")].copy()
    avg_overall_df = avg_df[avg_df["公司"] == "平均值"].copy()

    print(f"✅ 已載入 Excel：{EXCEL_PATH}")
    print(f"　公司資料：{len(company_df)} 筆，年度平均：{len(avg_by_year_df)} 筆，全期平均：{len(avg_overall_df)} 筆")

except Exception as e:
    print("❌ 載入 Excel 失敗：", e)
    traceback.print_exc()
    df = pd.DataFrame()

@app.route("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/ping")
def ping():
    return jsonify({"ok": True})

@app.route("/get_indicator")
def get_indicator():
    import json
    from flask import Response
    import numpy as np

    global company_df, avg_by_year_df, avg_overall_df

    try:
        q = (request.args.get("company") or "").strip()
        if not q:
            return jsonify({"error": "請提供 company 參數"}), 400

        norm = q.replace("'", "").replace(" ", "")

        if df.empty:
            return jsonify({"error": "伺服器未成功載入 Excel"}), 500

        # 🔍 模糊搜尋公司名稱
        mask = df["公司"].astype(str).str.replace(" ", "", regex=False).str.contains(norm, na=False)
        rows = df[mask]

        if rows.empty:
            return jsonify({"error": f"找不到公司：'{q}'"}), 404

        # ------------------------------
        # 🔧 清理數據：NaN、Inf、Timestamp
        # ------------------------------
        clean_rows = rows.copy()

        # NaN、inf、-inf → None
        clean_rows = clean_rows.replace([np.nan, np.inf, -np.inf], None)

        # Timestamp → YYYY-MM-DD
        for col in clean_rows.columns:
            if pd.api.types.is_datetime64_any_dtype(clean_rows[col]):
                clean_rows[col] = clean_rows[col].dt.strftime("%Y-%m-%d")

        # ------------------------------
        # 🧮 同產業平均值（年度與全期）
        # ------------------------------
        # 年度平均值：轉成 dict 陣列
        avg_by_year = []
        if not avg_by_year_df.empty:
            avg_by_year = avg_by_year_df.replace({np.nan: None}).to_dict(orient="records")

        # 全期平均值：取第一筆
        avg_overall = {}
        if not avg_overall_df.empty:
            avg_overall = avg_overall_df.iloc[0].replace({np.nan: None}).to_dict()


        # ------------------------------
        # 🔰 組合完整 JSON
        # ------------------------------
        result = {
            "company": q,
            "data": clean_rows.to_dict(orient="records"),
            "average_by_year": avg_by_year,
            "average_overall": avg_overall
        }


        return jsonify(result)

    except Exception as e:
        import traceback
        print("❌ /get_indicator 錯誤：", e)
        traceback.print_exc()
        return jsonify({
            "error": "伺服器內部錯誤",
            "detail": str(e)
        }), 500

@app.route("/chatgpt_advice", methods=["POST"])
def chatgpt_advice():
    try:
        print("🧠 /chatgpt_advice 收到請求：", request.get_json(silent=True))
        if client is None:
            print("❌ client is None")
            return jsonify({"error": "後端未設定 OPENAI_API_KEY"}), 500

        payload = request.get_json(silent=True) or {}
        company = (payload.get("company") or "該公司").strip()
        indicators = payload.get("indicators") or {}

        # 僅取有數值的指標
        numeric_items = {k: v for k, v in indicators.items() if isinstance(v, (int, float))}

        prompt = (
            f"請根據以下指標數值，為公司「{company}」提供簡短中文財務分析建議：\n"
            + "\n".join([f"- {k}: {v}" for k, v in numeric_items.items()])
        )
        print("🧠 準備送出 prompt：", prompt[:200])

        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.4,
            messages=[
                {"role": "system", "content": "你是謹慎的財務分析專家，輸出簡潔中文建議。"},
                {"role": "user", "content": prompt},
            ],
        )
        advice = completion.choices[0].message.content.strip()
        print("✅ ChatGPT 回傳內容：", advice[:150])
        return jsonify({"advice": advice})

    except Exception as e:
        print("❌ /chatgpt_advice 錯誤：", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# ====================== 🧠 多年度 AI 分析（正式報告版＋舉例說明） ======================
@app.route("/chatgpt_multi_advice", methods=["POST"])
def chatgpt_multi_advice():
    try:
        payload = request.get_json(silent=True) or {}
        company = (payload.get("company") or "該公司").strip()
        all_years_data = payload.get("all_years") or []

        if not all_years_data:
            return jsonify({"error": "缺少年度資料"}), 400
        if client is None:
            return jsonify({"error": "後端未設定 OPENAI_API_KEY"}), 500

        annual_advice = {}
        for row in all_years_data:
            year = str(row.get("年份") or str(row.get("年月"))[:4])
            indicators = {k: v for k, v in row.items() if isinstance(v, (int, float))}

            # 🧩 改版 prompt：以正式報告語氣撰寫 + 結尾附舉例
            prompt = f"""
你是一位專業的財務分析師，請根據以下 {year} 年公司「{company}」的財務指標，
撰寫一份中文財務分析建議報告，包含以下部分：

1. 開頭一句：「根據{year}年的財務指標，對{company}的財務分析建議如下：」
2. 條列式分析（請以「1.」「2.」「3.」等格式），每條說明一個面向（如資產效率、負債管理、現金流、獲利能力等），
   並在句中直接引用指標名稱與數值，例如「負債占資產比率為28.38%，顯示公司負債管理良好」。
3. 最後加上總結段，簡述整體財務體質與未來方向。
4. 最後新增一段「舉例：」說明，提供可實際執行的具體建議，例如改善資金運用或強化風險控管策略。
5. 請勿使用 **粗體** 或 Markdown 標記，維持純文字格式。

以下是指標資料：
{indicators}
"""

            completion = client.chat.completions.create(
                model=OPENAI_MODEL,
                temperature=0.4,
                messages=[
                    {"role": "system", "content": "你是嚴謹且具專業判斷的財務分析專家，請撰寫正式報告風格的中文財務分析，每項建議後附具體舉例。"},
                    {"role": "user", "content": prompt},
                ],
            )
            text = completion.choices[0].message.content.strip()
            annual_advice[year] = text

        # 🧾 五年整體分析（2020–2024） — 同樣採用報告式 + 舉例結尾
        recent_years = sorted(annual_advice.keys())[-5:]
        summary_prompt = f"""
你是一位資深財務顧問，請根據公司「{company}」最近五年的財務建議（{', '.join(recent_years)}），
撰寫一份「2020–2024 整體財務分析建議」，格式與年度分析相同，包含：

1. 開頭句：「根據2020–2024年的財務趨勢，對{company}的整體財務分析建議如下：」
2. 條列三至五項主要財務重點（如現金流、負債結構、營運效率、獲利能力等）。
3. 結論段落總結整體財務健康狀況與未來發展方向。
4. 結尾請加一段「舉例：」提出實際可執行的建議（例如調整資本結構、提升資金運用效率等）。
5. 請勿使用 **粗體** 或 Markdown 標記。

請根據你的專業，輸出完整的中文文字分析報告。
"""

        completion_sum = client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.4,
            messages=[
                {"role": "system", "content": "你是資深財務顧問，撰寫正式中文財務報告。"},
                {"role": "user", "content": summary_prompt},
            ],
        )
        summary_text = completion_sum.choices[0].message.content.strip()

        return jsonify({
            "annual": annual_advice,
            "summary_5yr": summary_text
        })

    except Exception as e:
        print("❌ /chatgpt_multi_advice 錯誤：", e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500



@app.route("/list_companies")
def list_companies():
    try:
        if df.empty:
            return jsonify({"companies": []})
        companies = sorted(df["公司"].dropna().astype(str).unique().tolist())
        return jsonify({"companies": companies})
    except Exception as e:
        print("❌ /list_companies 錯誤：", e)
        traceback.print_exc()
        return jsonify({"companies": []}), 500

# ====================== 📤 匯出報告：Word 專業版（含表格＋折線圖＋AI建議） ======================
from datetime import datetime
from io import BytesIO
import base64

try:
    from docx import Document
    from docx.shared import Inches, Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    DOCX_OK = True
except Exception:
    DOCX_OK = False

def _b64_to_bytes(b64):
    """將 base64 圖片字串轉換為 bytes"""
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    return base64.b64decode(b64)

@app.route("/export_report", methods=["POST"])
def export_report():
    """生成正式 Word 報告（含表格、圖表與 AI 建議）"""
    if not DOCX_OK:
        return jsonify({"error": "伺服器未安裝 python-docx"}), 500

    try:
        payload = request.get_json(force=True) or {}
        company = (payload.get("company") or "未命名公司").strip()
        selected_year = payload.get("selected_year", "")  # ✅ 新增接收選擇的年度
        indicators = payload.get("indicators_summary") or []  # [{name,value,avg,light}]
        charts = payload.get("charts") or []                  # [{title,img_base64}]
        ai_annual = payload.get("ai_annual") or {}            # {"2015":"...", ...}
        ai_summary_5yr = payload.get("ai_summary_5yr") or ""  # str

        # 🔧 準備輸出目錄
        reports_dir = os.path.join(BASE_DIR, "reports")
        os.makedirs(reports_dir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        docx_name = f"{company}_財務分析報告_{ts}.docx"
        docx_path = os.path.join(reports_dir, docx_name)

        # ====================== 📝 產生 Word 報告 ======================
        doc = Document()

        # 封面頁
        # ✅ 標題置中＋顯示年度
        main_title = f"公司財務分析報告（{selected_year} 年）" if selected_year else "公司財務分析報告"
        heading = doc.add_heading(main_title, level=0)
        heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title = doc.add_paragraph(f"公司名稱：{company}")
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        date_p = doc.add_paragraph(f"生成日期：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
        date_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph("（本報告由智慧財報分析儀表板自動生成）").alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_page_break()

        # 第一部分：財務指標摘要
        doc.add_heading("第一部分：財務指標摘要", level=1)
        if indicators:
            table = doc.add_table(rows=1, cols=4)
            table.style = "Table Grid"
            hdr = table.rows[0].cells
            hdr[0].text = "指標名稱"
            hdr[1].text = "公司數值"
            hdr[2].text = "同產業平均"
            hdr[3].text = "等級判斷"

            light_map = {"green": "🟢", "yellow": "🟡", "red": "🔴", "gray": "⚪"}
            for row in indicators:
                cells = table.add_row().cells
                cells[0].text = str(row.get("name", ""))
                cells[1].text = str(row.get("value", ""))
                cells[2].text = str(row.get("avg", ""))
                cells[3].text = light_map.get(row.get("light", "gray"), "⚪")
        else:
            doc.add_paragraph("（無可用財務指標資料）")

        doc.add_page_break()

        # 第二部分：歷年財務趨勢圖
        doc.add_heading("第二部分：歷年財務趨勢圖", level=1)
        if charts:
            for i, chart in enumerate(charts, 1):
                title = chart.get("title", f"圖 {i}")
                img_b64 = chart.get("img_base64")
                if not img_b64:
                    continue
                doc.add_paragraph(f"{i}. {title}")
                img_data = _b64_to_bytes(img_b64)
                img_stream = BytesIO(img_data)
                doc.add_picture(img_stream, width=Inches(6.5))
                doc.add_paragraph("")
        else:
            doc.add_paragraph("（未提供趨勢圖資料）")

        doc.add_page_break()

        # ✅ 第三部分：AI 財務分析建議（只顯示所選年度）
        ai_title = f"第三部分：AI 財務分析建議（{selected_year} 年）" if selected_year else "第三部分：AI 財務分析建議"
        doc.add_heading(ai_title, level=1)

        if ai_annual and selected_year and selected_year in ai_annual:
            doc.add_paragraph(ai_annual[selected_year])
        elif not selected_year and ai_annual:
            for year in sorted(ai_annual.keys()):
                doc.add_heading(f"{year} 年財務分析建議", level=2)
                lines = str(ai_annual[year]).split("\n")
                for line in lines:
                    doc.add_paragraph(line.strip())
        else:
            doc.add_paragraph("（無對應年度 AI 建議資料）")
        doc.add_page_break()

        # ✅ 第四部分：AI 財務分析整體建議（2020–2024）
        doc.add_heading("第四部分：AI 財務分析整體建議（2020–2024）", level=1)
        summary_text = payload.get("ai_summary_5yr", "").strip()
        if summary_text:
            lines = summary_text.split("\n")
            for line in lines:
                if line.strip():
                    doc.add_paragraph(line.strip())
        else:
            doc.add_paragraph("（目前無五年整體分析資料）")

        # 📦 儲存報告
        doc.save(docx_path)

        # ✅ 回傳給前端可下載的相對路徑
        return jsonify({
            "word": f"reports/{docx_name}",
            "pdf": None  # 若要加 PDF 轉換，可再擴充
        })

    except Exception as e:
        print("❌ 匯出報告錯誤：", e)
        traceback.print_exc()
        return jsonify({"error": f"匯出報告失敗：{e}"}), 500

if __name__ == "__main__":
    print("✅ Flask 啟動：http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
