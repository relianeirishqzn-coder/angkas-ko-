// src/fare.js
'use strict';

const BASE_FARE = { motor: 20, tricycle: 25, car: 60 };
const PER_KM = { motor: 8, tricycle: 10, car: 15 };

// Deterministic pseudo-distance derived from the destination text, so the
// same pickup/destination pair always quotes the same fare (stand-in for a
// real Google Maps Distance Matrix call).
function estimateDistanceKm(destination) {
  let hash = 0;
  const s = String(destination || '');
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 97;
  }
  return 1 + (hash % 60) / 10; // 1.0km - 6.9km
}

function computeFare({ vehicleType, destination, studentDiscount, seniorMode }) {
  if (!BASE_FARE[vehicleType]) {
    throw new Error('Invalid vehicle type');
  }
  const distanceKm = estimateDistanceKm(destination);
  let fare = BASE_FARE[vehicleType] + distanceKm * PER_KM[vehicleType];

  let discountApplied = null;
  if (seniorMode) {
    fare *= 0.8;
    discountApplied = 'senior_20';
  } else if (studentDiscount) {
    fare *= 0.9;
    discountApplied = 'student_10';
  }

  fare = Math.round(fare * 100) / 100;
  const etaMin = Math.max(3, Math.round(distanceKm * 2));
  return { fare, distanceKm, etaMin, discountApplied };
}

module.exports = { computeFare, estimateDistanceKm, BASE_FARE, PER_KM };
