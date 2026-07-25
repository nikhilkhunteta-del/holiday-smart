'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AIRecommendationOutput } from '@/lib/flights/getAIRecommendation';
import type { AssembledCombination } from '@/lib/flights/assembleRecommendation';

export interface AIRecommendationResult extends AIRecommendationOutput {
  recommendedCombination?: Record<string, any> | null;
}

export interface SelectedMatrixCell {
  outboundDate: string;
  returnDate: string;
}

interface FlightInsightsContextValue {
  aiResult: AIRecommendationResult | null;
  aiLoading: boolean;
  setAIResult: (result: AIRecommendationResult) => void;
  setAILoading: (loading: boolean) => void;
  // Set from ComplianceCalculator's handleCellClick (in addition to, not
  // instead of, opening the leg-options modal) so the per-cell price
  // history card below the matrix can react to the same click without
  // prop-drilling through page.tsx, a server component.
  selectedMatrixCell: SelectedMatrixCell | null;
  setSelectedMatrixCell: (cell: SelectedMatrixCell) => void;
  // Incremented from the modal's onClose (X / outside click / Esc — Radix
  // routes all three through one onOpenChange callback, so one signal
  // covers every closure path). A counter, not a boolean, so effects that
  // depend on it fire on every close, not just the first true->false edge.
  // PriceHistorySection decides for itself whether to actually act on it
  // (e.g. first-time-only auto-scroll).
  modalCloseCount: number;
  notifyModalClosed: () => void;
}

const FlightInsightsContext = createContext<FlightInsightsContextValue>({
  aiResult: null,
  aiLoading: true,
  setAIResult: () => {},
  setAILoading: () => {},
  selectedMatrixCell: null,
  setSelectedMatrixCell: () => {},
  modalCloseCount: 0,
  notifyModalClosed: () => {},
});

export function FlightInsightsProvider({ children }: { children: ReactNode }) {
  const [aiResult, setAIResultState] = useState<AIRecommendationResult | null>(null);
  const [aiLoading, setAILoading] = useState(true);
  const [selectedMatrixCell, setSelectedMatrixCell] = useState<SelectedMatrixCell | null>(null);
  const [modalCloseCount, setModalCloseCount] = useState(0);

  const setAIResult = useCallback((result: AIRecommendationResult) => {
    setAIResultState(result);
    setAILoading(false);
  }, []);

  const notifyModalClosed = useCallback(() => {
    setModalCloseCount(c => c + 1);
  }, []);

  return (
    <FlightInsightsContext.Provider value={{
      aiResult, aiLoading, setAIResult, setAILoading,
      selectedMatrixCell, setSelectedMatrixCell,
      modalCloseCount, notifyModalClosed,
    }}>
      {children}
    </FlightInsightsContext.Provider>
  );
}

export function useFlightInsights() {
  return useContext(FlightInsightsContext);
}

// Helper: check if a combination matches the AI recommended combination
// Used by matrix and leg options to identify OUR PICK
export function isAIPick(
  combination: {
    outbound_date: string;
    return_date: string;
    origin_iata?: string;
    outbound_carrier?: string;
    return_carrier?: string;
  },
  aiRecommended: AssembledCombination | null,
): boolean {
  if (!aiRecommended) return false;
  return (
    combination.outbound_date === aiRecommended.outbound_date &&
    combination.return_date   === aiRecommended.return_date &&
    (combination.origin_iata === undefined ||
     combination.origin_iata === aiRecommended.origin_iata) &&
    (combination.outbound_carrier === undefined ||
     combination.outbound_carrier === aiRecommended.outbound_carrier) &&
    (combination.return_carrier === undefined ||
     combination.return_carrier === aiRecommended.return_carrier)
  );
}
