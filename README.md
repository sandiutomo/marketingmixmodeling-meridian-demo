![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.x-3776AB?style=flat-square&logo=python&logoColor=white)
![Dashboard](https://img.shields.io/badge/Type-Interactive%20Dashboard-4285F4?style=flat-square)
![Prototype](https://img.shields.io/badge/Status-Prototype-FF9500?style=flat-square)
![Free](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

---

# Marketing Mix Model Studio | Understand Which Channels Drive Your Revenue

**Marketing Mix Model Studio** is a prototype dashboard for evaluating the **revenue impact of marketing channels**.

It applies marketing mix modeling techniques to quantify the contribution of channels such as TV, paid search, and social. Users can upload data, run the model, and explore results including ROI, contribution, and scenario simulations.

Built as a learning tool and reference demo, it showcases practical approaches to attribution modeling and media mix optimization.

---
<td width="50%">

<img src="https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3R6N25rMzJhcmdjYnhyOW9yZXVvaHhzZ2IwZzV4MzdudGx2ZmxqZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/X0aJMLC1yNcs35c3Vc/giphy.gif" width="100%" />

</td>
<table>
<tr>

<td width="50%">

## What You Can Do

| What | How It Helps |
|---|---|
| **See channel impact** | Upload your sales and marketing spend data — get back real ROI numbers per channel |
| **Build confidence intervals** | Not just a single number — understand the range of what could be true |
| **Run scenarios** | Slide spend up and down for each channel and see projected revenue impact |
| **Optimize budget** | Get a recommendation for how to rebalance spend to maximize revenue |
| **Compare channels** | See which channels contributed most to your total revenue |
| **Check model quality** | See diagnostic charts that tell you if the results are trustworthy |
| **Try without setup** | 5 ready-to-go sample datasets included — no data prep needed to explore |

</td>
</tr>
</table>


## Get Started (15 minutes)

### Step 1: Open Your Command Line

This is where you'll paste commands. Don't worry — just copy and paste what you see.

**On Mac:**
1. Hold `Cmd + Space` (opens search)
2. Type `terminal` and press Enter
3. A black window should open

**On Windows:**
1. Press `Win + R` (opens a run box)
2. Type `powershell` and press Enter
   - Or just search for "PowerShell" in the Start menu
3. A blue window should open

You're now in the command line. Ready to proceed? ✓

---

### Step 2: Check Your Setup

You'll need two free tools. Check if they're on your machine:

```bash
node --version
python3 --version
```

**Don't see them?**
- **Node.js:** Download from [nodejs.org](https://nodejs.org/) — pick "LTS" version
- **Python:** Download from [python.org](https://www.python.org/) or use Homebrew on Mac (`brew install python@3.13`)

---

### Step 3: Start the Backend (the math engine)

> 💡 **Just exploring?**  
> You can skip the backend setup entirely and run the [Step 4 (Frontend)](#step-4-start-the-frontend-in-a-new-command-line-window) only. The app includes a demo/mock mode so you can explore the UI and workflow without running the modeling engine.

Copy and paste this into your command line:

```bash
cd backend
python3.13 -m venv venv313
source venv313/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

**You should see:**
```
INFO:     Uvicorn running on http://127.0.0.1:8001
```

✓ **Leave this window open.** It's running in the background. Don't close it.

---

### Step 4: Start the Frontend (in a new command line window)

Open **another** terminal or PowerShell (using the same steps as Step 2).

Then copy and paste:

```bash
cd frontend
npm install
npm run dev
```

**You should see:**
```
▲ Next.js ready
  - Local:        http://localhost:3000
```

---

### Step 5: Open the Dashboard

Click or paste this into your browser: **http://localhost:3000**

You should see a form with three steps:
1. Pick a sample dataset (or upload your own CSV)
2. Set options (date range, channel names, etc.)
3. Click "Run Model"

After it finishes, you'll see 6 tabs with your results.

---

## The Sample Datasets

Already built in, no downloading needed:

| Name | What's Inside | Use Case |
|---|---|---|
| **Geo Level (basic)** | TV, Paid Search, Social, Display across 4 regions | Start here — simplest example |
| **Geo Level (with reach/frequency)** | Same, but includes YouTube reach & frequency data | If you have audience size data |
| **National** | TV, Radio, Paid Search, Social, Display at country level | Whole-country view |
| **With Organic** | All of the above plus organic search | When organic is important |
| **Indonesia** | Tiktok, Shopee, Instagram, YouTube, Google Ads, Meta in Indonesian Rupiah | E-commerce example |

Don't have data? Just pick one of these and click "Run Model" to see how it works.

---

## What Happens After You Run the Model

The dashboard gives you **6 tabs of insights:**

1. **Budget Allocation** — How much should you spend on each channel?
2. **True ROI** — What's the actual return on each channel? (with ranges of uncertainty)
3. **Scenario Planning** — "What if I spend 20% more on TV?" → See projected revenue
4. **Channel Contribution** — Pie chart: which channels drove your revenue?
5. **Cross-Channel Impact** — Do channels help each other? (halo effects)
6. **Geo Breakdown** — Performance by region (if you have multi-region data)

All numbers update instantly as you change assumptions.

---

## Upload Your Own Data

Don't have it formatted perfectly. The dashboard auto-detects:
- Which column is your sales/revenue
- Which columns are marketing spend
- Which column is your date
- Optional: geographic regions, audience size data, competitor info

Just make sure your CSV has:
- A date/week column
- A sales or revenue column
- Spend columns (labeled like `TV_spend`, `Social_spend`, etc.)

---

## Next Steps

Want to understand the technical details? Read **[TECHNICAL_README.md](TECHNICAL_README.md)** for how the model works.

---

## License & Important Note

**Free to use for learning only.** See LICENSE file.

**This is a prototype and reference demo**, built to show how modern marketing teams approach the attribution problem. It's not production-ready.

Use it to:
- ✓ Learn how attribution modeling works
- ✓ Explore with sample data
- ✓ Understand the concepts
- ✗ Don't use it for real marketing budget decisions

---

[![Made by Sandi Utomo](https://img.shields.io/badge/Made%20by-Sandi%20Utomo%20😎-5A6AE8?style=flat-square&logo=github&logoColor=white)](https://github.com/sandiutomo)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Sandi%20Utomo-0A66C2?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/sandiutomo/)