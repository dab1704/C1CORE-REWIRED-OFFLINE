# Nabz Test Data (synthetic)

## What is here
- reports/  25 synthetic lab report images (3 layouts: A table, B teal two-column, C phone dark-mode screenshot)
- chats/    5 WhatsApp-style chat screenshots with a symptom message next to a report
- ground_truth.csv       expected tier + out-of-range values for every report (DO NOT feed to the model)
- chat_ground_truth.csv  same for chat screenshots

## Mix (25 reports)
- 8 URGENT hidden among the rest: K 6.8, Na 121, Glucose 410, Hb 6.9, Creatinine 4.2, Platelets 18, K 2.6, Calcium 6.1
- 3 TREND reports, one patient (Kavita Reddy): fasting glucose 140 -> 165 -> 190 (12 Aug, 30 Sep, 14 Nov 2026)
- 4 WATCH (mildly out of range): K 5.4, Hb 11.2, LDL 168, TSH 6.8
- 10 ROUTINE (all values in range)
- Filenames are shuffled so urgent ones are not clustered.

## Still to do by hand
- 4-5 phone photos of a screen showing a report (tilted, glare), add to reports/photos/
- Replace/add 1-2 layouts made in Docs/Canva if time permits

## Evaluation plan
Arrival order (file number = arrival order) vs Nabz ranking. Metric: urgent reports seen in the first 10 positions / first hour of the simulated inbox.
Label as a simulation on synthetic data.
