'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AIRecommendationOutput } from '@/lib/flights/getAIRecommendation';
import type { AssembledCombination } from '@/lib/flights/assembleRecommendation';

export interface AIRecommendationResult extends AIRecommendationOutput {
  recommendedCombination: AssembledCombination | null;
}

interface FlightInsightsContextValue {
  aiResult: AIRecommendationResult | null;
  aiLoading: boolean;
  setAIResult: (result: AIRecommendationResult) => void;
  setAILoading: (loading: boolean) => void;
}

const FlightInsightsContext = createContext<FlightInsightsContextValue>({
  aiResult: null,
  aiLoading: true,
  setAIResult: () => {},
  setAILoading: () => {},
});

export function FlightInsightsProvider({ children }: { children: ReactNode }) {
  const [aiResult, setAIResultState] = useState<AIRecommendationResult | null>(null);
  const [aiLoading, setAILoading] = useState(true);

  const setAIResult = useCallback((result: AIRecommendationResult) => {
    setAIResultState(result);
    setAILoading(false);
  }, []);

  return (
    <FlightInsightsContext.Provider value={{ aiResult, aiLoading, setAIResult, setAILoading }}>
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
