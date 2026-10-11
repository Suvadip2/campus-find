function normalize(value = '') {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenSimilarity(left = '', right = '') {
  const leftTokens = new Set(normalize(left).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(normalize(right).split(/\s+/).filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export function evaluatePossibleMatch(left, right) {
  if (left.type === right.type || left.status !== 'open' || right.status !== 'open') return null;
  if (!left.ownerId || !right.ownerId || left.ownerId === right.ownerId) return null;
  if (normalize(left.category) !== normalize(right.category)) return null;

  const titleScore = tokenSimilarity(left.title, right.title);
  if (titleScore < 0.35) return null;

  const corroboratingDetails = [];
  let score = titleScore * 0.45 + 0.15;

  for (const [field, weight, label] of [['brand', 0.15, 'brand'], ['color', 0.12, 'color']]) {
    const leftValue = normalize(left[field]);
    const rightValue = normalize(right[field]);
    if (!leftValue || !rightValue) continue;
    if (leftValue !== rightValue) return null;
    score += weight;
    corroboratingDetails.push(label);
  }

  const descriptionScore = tokenSimilarity(left.description, right.description);
  if (descriptionScore > 0) {
    score += descriptionScore * 0.08;
    if (descriptionScore >= 0.2) corroboratingDetails.push('description');
  }

  const locationScore = tokenSimilarity(left.location, right.location);
  if (locationScore > 0) {
    score += locationScore * 0.05;
    if (locationScore >= 0.2) corroboratingDetails.push('location');
  }

  if (corroboratingDetails.length === 0 || score < 0.58) return null;
  return {
    score: Math.round(score * 100),
    details: corroboratingDetails
  };
}
