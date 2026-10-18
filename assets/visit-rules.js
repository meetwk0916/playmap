/* Shared interpretation only: callers retain the original record and decide how to display it. */
(function () {
'use strict';
var birthDate = '2024-06-11';
function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
function ageInMonths(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < birthDate) return -1;
  var parts = date.split('-').map(Number);
  var parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today()) return -1;
  var birth = birthDate.split('-').map(Number);
  return (parts[0] - birth[0]) * 12 + parts[1] - birth[1] - (parts[2] < birth[2] ? 1 : 0);
}
function inspect(visit) {
  var months = ageInMonths(visit.visitedOn);
  var score = visit.score;
  var validScore = typeof score === 'number' && Number.isFinite(score) && score >= 1 && score <= 5 && Math.round(score * 10) === score * 10;
  var photo = visit.photo;
  var validPhoto = typeof photo === 'string' && (/^assets\/visits\/[a-z0-9-]+\.jpg$/.test(photo) ||
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo) && photo.length <= 450000);
  return { ageMonths: months, validScore: validScore, validPhoto: validPhoto, complete: months >= 0 && validScore && validPhoto };
}
window.VisitRules = { birthDate: birthDate, today: today, inspect: inspect };
})();
