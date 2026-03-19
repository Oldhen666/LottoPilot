# Strategy Lab Feature Weights

How each feature weight affects number generation. All weights are 0–1; 0.5 = neutral/balanced.

---

## Structure

| Feature | Effect | High Weight (→1) | Low Weight (→0) |
|---------|--------|------------------|-----------------|
| **Odd/Even** | Controls odd vs even number ratio | More odd numbers | More even numbers |
| **Low/High** | Controls small vs large numbers (split at midpoint) | More large numbers (e.g. 26–49) | More small numbers (e.g. 1–25) |
| **Sum range** | Controls total sum of the pick | Higher total sum | Lower total sum |
| **Max gap** | Influences maximum gap between adjacent numbers | More spread (larger gaps) | Numbers closer together |
| **Avg gap** | Influences average spacing between numbers | More spread | Numbers closer together |
| **Clustering** | Controls how clustered the numbers are | More clustered (closer together) | More spread out |
| **Sum deviation** | *(Mapped to sum range in current logic)* | — | — |

---

## Position

| Feature | Effect | High Weight (→1) | Low Weight (→0) |
|---------|--------|------------------|-----------------|
| **Position freq** | Biases toward numbers in typical range for current slot | Numbers match historical position patterns | More random position distribution |
| **Edge bias** | Controls preference for edge numbers (1, 2, 48, 49) | More edge numbers | Fewer edge numbers |
| **Mid density** | Controls preference for middle-range numbers (e.g. 20–30) | More middle numbers | Fewer middle numbers |

---

## Trend

| Feature | Effect | High Weight (→1) | Low Weight (→0) |
|---------|--------|------------------|-----------------|
| **Short activity** | Influences hot-number preference (with Recency bias) | More hot numbers (frequently drawn) | Fewer hot numbers |
| **Long deviation** | Influences cold-number preference | Fewer cold numbers | More cold numbers (rarely drawn) |
| **Recency bias** | Influences hot-number preference (with Short activity) | More recently active numbers | Less recency bias |

---

## Risk

| Feature | Effect | High Weight (→1) | Low Weight (→0) |
|---------|--------|------------------|-----------------|
| **Common penalty** | Penalizes consecutive numbers (e.g. 1-2-3, 4-5-6) | Fewer consecutive pairs | More consecutive numbers allowed |
| **Birthday penalty** | Penalizes numbers 1–31 (common birthday dates) | Fewer numbers in 1–31 | More numbers in 1–31 |
| **Symmetry penalty** | Penalizes symmetric pairs (e.g. 1 & 49, 2 & 48) | Fewer symmetric pairs | More symmetric pairs allowed |

---

## Lucky Numbers (Personal Bias)

| Setting | Effect |
|---------|--------|
| **Off** | No personal bias |
| **Low** | ~1.7% boost for your lucky numbers when selecting from balanced pool |
| **Medium** | ~3.3% boost |
| **High** | 5% max boost |

---

## Generation Flow

1. **Hot pool**: Top 15 most frequently drawn numbers (from history)
2. **Cold pool**: Bottom 15 least frequently drawn numbers
3. **Balanced pool**: Remaining numbers

Each pick = some from hot + some from cold + rest from balanced pool.  
Structure, Position, and Risk weights apply when selecting from the **balanced pool**.  
Trend weights control how many numbers come from hot vs cold.  
Lucky Numbers add a small boost to your chosen numbers in the balanced pool.
