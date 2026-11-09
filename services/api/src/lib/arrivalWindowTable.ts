/**
 * Arrival-window quantile table, written by
 * `npm run projection:backtest -- --analysis windows --write-windows`. Do not edit by hand.
 * Source: OpenSplitTime public results, 5 courses (Hardrock CCW, Bear, Never Summer 100K/60K, Quad Rock 50), 3817 finishers; used with OpenSplitTime's permission (Nov 2026)
 */
import type { WindowTable } from "./arrivalWindows.js";

export const ARRIVAL_WINDOW_TABLE: WindowTable | null = {
  "source": "OpenSplitTime public results, 5 courses (Hardrock CCW, Bear, Never Summer 100K/60K, Quad Rock 50), 3817 finishers; used with OpenSplitTime's permission (Nov 2026)",
  "bands": [
    {
      "target": "next",
      "progressLo": 0,
      "progressHi": 0.25,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.1762,
      "q90": 0.1181,
      "coverage": 0.735,
      "samples": 3202
    },
    {
      "target": "next",
      "progressLo": 0.25,
      "progressHi": 0.5,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.1203,
      "q90": 0.2229,
      "coverage": 0.788,
      "samples": 10370
    },
    {
      "target": "next",
      "progressLo": 0.5,
      "progressHi": 0.75,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.2361,
      "q90": 0.2993,
      "coverage": 0.745,
      "samples": 7019
    },
    {
      "target": "next",
      "progressLo": 0.75,
      "progressHi": 1.01,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.1842,
      "q90": 0.2007,
      "coverage": 0.77,
      "samples": 6800
    },
    {
      "target": "finish",
      "progressLo": 0,
      "progressHi": 0.25,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.1067,
      "q90": 0.1445,
      "coverage": 0.796,
      "samples": 3202
    },
    {
      "target": "finish",
      "progressLo": 0.25,
      "progressHi": 0.5,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.0944,
      "q90": 0.165,
      "coverage": 0.772,
      "samples": 10370
    },
    {
      "target": "finish",
      "progressLo": 0.5,
      "progressHi": 0.75,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.1708,
      "q90": 0.1318,
      "coverage": 0.764,
      "samples": 7019
    },
    {
      "target": "finish",
      "progressLo": 0.75,
      "progressHi": 1.01,
      "sigmaTier": "coldStart",
      "hasHistory": false,
      "q10": -0.1399,
      "q90": 0.1103,
      "coverage": 0.799,
      "samples": 2983
    },
    {
      "target": "next",
      "progressLo": 0,
      "progressHi": 0.25,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.1842,
      "q90": 0.1155,
      "coverage": 0.735,
      "samples": 3202
    },
    {
      "target": "next",
      "progressLo": 0.25,
      "progressHi": 0.5,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.1228,
      "q90": 0.2197,
      "coverage": 0.79,
      "samples": 10370
    },
    {
      "target": "next",
      "progressLo": 0.5,
      "progressHi": 0.75,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.2314,
      "q90": 0.3005,
      "coverage": 0.745,
      "samples": 7019
    },
    {
      "target": "next",
      "progressLo": 0.75,
      "progressHi": 1.01,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.1814,
      "q90": 0.2019,
      "coverage": 0.772,
      "samples": 6800
    },
    {
      "target": "finish",
      "progressLo": 0,
      "progressHi": 0.25,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.1071,
      "q90": 0.1305,
      "coverage": 0.798,
      "samples": 3202
    },
    {
      "target": "finish",
      "progressLo": 0.25,
      "progressHi": 0.5,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.0923,
      "q90": 0.1602,
      "coverage": 0.774,
      "samples": 10370
    },
    {
      "target": "finish",
      "progressLo": 0.5,
      "progressHi": 0.75,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.1678,
      "q90": 0.1319,
      "coverage": 0.763,
      "samples": 7019
    },
    {
      "target": "finish",
      "progressLo": 0.75,
      "progressHi": 1.01,
      "sigmaTier": "coarseHistory",
      "hasHistory": false,
      "q10": -0.1373,
      "q90": 0.1106,
      "coverage": 0.799,
      "samples": 2983
    },
    {
      "target": "next",
      "progressLo": 0,
      "progressHi": 0.25,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.1907,
      "q90": 0.1046,
      "coverage": 0.724,
      "samples": 3202
    },
    {
      "target": "next",
      "progressLo": 0.25,
      "progressHi": 0.5,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.1226,
      "q90": 0.2148,
      "coverage": 0.789,
      "samples": 10370
    },
    {
      "target": "next",
      "progressLo": 0.5,
      "progressHi": 0.75,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.2234,
      "q90": 0.3019,
      "coverage": 0.746,
      "samples": 7019
    },
    {
      "target": "next",
      "progressLo": 0.75,
      "progressHi": 1.01,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.1776,
      "q90": 0.2056,
      "coverage": 0.771,
      "samples": 6800
    },
    {
      "target": "finish",
      "progressLo": 0,
      "progressHi": 0.25,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.1012,
      "q90": 0.1068,
      "coverage": 0.797,
      "samples": 3202
    },
    {
      "target": "finish",
      "progressLo": 0.25,
      "progressHi": 0.5,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.0863,
      "q90": 0.1473,
      "coverage": 0.776,
      "samples": 10370
    },
    {
      "target": "finish",
      "progressLo": 0.5,
      "progressHi": 0.75,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.1596,
      "q90": 0.13,
      "coverage": 0.763,
      "samples": 7019
    },
    {
      "target": "finish",
      "progressLo": 0.75,
      "progressHi": 1.01,
      "sigmaTier": "similarHistory",
      "hasHistory": false,
      "q10": -0.1333,
      "q90": 0.115,
      "coverage": 0.8,
      "samples": 2983
    }
  ]
};
