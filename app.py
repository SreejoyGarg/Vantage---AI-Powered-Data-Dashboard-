from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from io import BytesIO
import os
import pandas as pd
from openai import OpenAI

load_dotenv()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB upload limit

client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

MAX_ROWS = 30000  # cap rows sent to the browser so client-side filtering stays fast


def generate_ai_summary(primary_metric, total_value, top_values):
    top_lines = "\n".join([f"- Top {col}: {val}" for col, val in top_values.items()])
    prompt = f"""
    Summarize this dataset in 2-3 plain-English sentences for a general audience:
    - Total {primary_metric}: {total_value}
    {top_lines}
    """
    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"AI summary failed: {e}")
        return "AI insight unavailable right now — showing raw stats above."


def read_csv_robustly(file):
    """Try common encodings/delimiters so real-world public CSVs don't just crash the app."""
    raw_bytes = file.read()
    encodings_to_try = ["utf-8", "utf-8-sig", "latin1", "cp1252"]

    last_error = None
    for encoding in encodings_to_try:
        try:
            df = pd.read_csv(BytesIO(raw_bytes), encoding=encoding, sep=None, engine="python")
            if len(df.columns) > 0:
                return df
        except Exception as e:
            last_error = e
            continue

    raise ValueError(str(last_error) if last_error else "Unknown parsing error")


def detect_date_column(df, exclude_cols):
    """Look for a column that parses as dates for most of its rows, to power a trend chart."""
    for col in df.columns:
        if col in exclude_cols:
            continue
        if df[col].dtype != object:
            continue
        try:
            parsed = pd.to_datetime(df[col], errors="coerce")
            valid_ratio = parsed.notna().mean()
            if valid_ratio > 0.9:
                return col
        except Exception:
            continue
    return None


def is_identifier_column(name, series, n):
    """Flags columns like 'CustomerID', 'Unnamed: 0', or 'index' so they don't get offered as a metric."""
    lname = str(name).strip().lower()
    if lname in ("id", "index") or lname.endswith("_id") or lname.endswith(" id") or lname.startswith("unnamed"):
        return True
    if n > 0 and series.nunique(dropna=True) == n:
        return True
    return False


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    file = request.files.get("csv_file")

    if file is None:
        return jsonify({"error": "No file received"}), 400

    try:
        df = read_csv_robustly(file)
    except Exception as e:
        return jsonify({"error": f"Could not read this file as a CSV: {str(e)}"}), 400

    if df.empty or len(df.columns) == 0:
        return jsonify({"error": "This file appears to be empty."}), 400

    df = df.dropna(axis=1, how="all")
    df = df.dropna(axis=0, how="all")

    full_row_count = len(df)

    numeric_cols_all = df.select_dtypes(include="number").columns.tolist()
    object_cols_all = df.select_dtypes(include="object").columns.tolist()
    n_full = len(df)

    # Compute totals/top-values on the FULL dataset before any sampling, so numbers stay accurate
    metric_candidates = [c for c in numeric_cols_all if not is_identifier_column(c, df[c], n_full)]
    if not metric_candidates:
        metric_candidates = numeric_cols_all

    if not metric_candidates:
        return jsonify({
            "error": "No numeric column found to analyze. This tool needs at least one number column (e.g. price, revenue, count, rating)."
        }), 400

    priority_names = ["revenue", "sales", "amount", "total", "price", "value", "count", "score", "rating"]
    primary_metric = None
    for name in priority_names:
        for col in metric_candidates:
            if name in col.lower():
                primary_metric = col
                break
        if primary_metric:
            break
    if not primary_metric:
        primary_metric = metric_candidates[0]

    df[primary_metric] = df[primary_metric].fillna(0)
    full_total_value = round(float(df[primary_metric].sum()), 2)

    filterable_cols_full = []
    for col in object_cols_all:
        nunique = df[col].nunique(dropna=True)
        if 1 < nunique <= 30 and nunique < n_full * 0.9:
            filterable_cols_full.append(col)

    top_values = {}
    for col in filterable_cols_full[:3]:
        try:
            top_values[col] = str(df.groupby(col)[primary_metric].sum().idxmax())
        except Exception:
            continue

    ai_summary = generate_ai_summary(primary_metric, full_total_value, top_values)

    # Now sample for what actually goes to the browser, purely for interactive performance
    sampled = False
    if full_row_count > MAX_ROWS:
        df = df.sample(MAX_ROWS, random_state=42)
        sampled = True

    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    object_cols = df.select_dtypes(include="object").columns.tolist()
    n = len(df)

    filterable_cols = []
    for col in object_cols:
        nunique = df[col].nunique(dropna=True)
        if 1 < nunique <= 30 and nunique < n * 0.9:
            filterable_cols.append(col)

    numeric_filterable = []
    for col in numeric_cols:
        if col == primary_metric:
            continue
        nunique = df[col].nunique(dropna=True)
        if 1 < nunique <= 15:
            numeric_filterable.append(col)

    date_column = detect_date_column(df, exclude_cols=filterable_cols)

    df_clean = df.copy()
    for col in numeric_cols:
        df_clean[col] = df_clean[col].fillna(0)
    for col in object_cols:
        if col == date_column:
            continue
        df_clean[col] = df_clean[col].fillna("Unknown").astype(str)

    if date_column:
        parsed_dates = pd.to_datetime(df[date_column], errors="coerce")
        df_clean[date_column] = parsed_dates.dt.strftime("%Y-%m-%d")
        df_clean[date_column] = df_clean[date_column].fillna("Unknown")

    filters = {}
    for col in filterable_cols:
        filters[col] = sorted(df_clean[col].unique().tolist())
    for col in numeric_filterable:
        filters[col] = sorted(df_clean[col].astype(str).unique().tolist())

    metric_options = [c for c in numeric_cols if not is_identifier_column(c, df[c], n)]
    if not metric_options:
        metric_options = numeric_cols
    if primary_metric not in metric_options:
        metric_options = [primary_metric] + metric_options

    return jsonify({
        "records": df_clean.to_dict(orient="records"),
        "filterable_columns": filterable_cols + numeric_filterable,
        "filters": filters,
        "numeric_columns": metric_options,
        "primary_metric": primary_metric,
        "total_value": full_total_value,
        "top_values": top_values,
        "ai_summary": ai_summary,
        "row_count": full_row_count,
        "sampled": sampled,
        "date_column": date_column
    })


@app.errorhandler(413)
def too_large(e):
    return jsonify({"error": "File is too large. Please upload a CSV under 50MB."}), 413


if __name__ == "__main__":
    app.run(debug=False)