import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import type { Proposal } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { getGroups, getHangouts } from "@/lib/api";
import { useEffect } from "react";

type Group = { id: string; name: string; memberCount: number; avatar: string };
type AppStore = {
  groups: Group[];
  proposals: Proposal[];
  addGroup: (name: string, id?: string) => void;
  addProposal: (proposal: Proposal) => void;
  replaceProposal: (proposal: Proposal) => void;
  reload: () => Promise<void>;
};

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ children }: PropsWithChildren) {
  const { configured, loading, session } = useAuth();
  const [groups, setGroups] = useState<Group[]>(configured ? [] : [
    { id: "demo-friends", name: "The Trail Mix", memberCount: 1, avatar: "🌿" },
  ]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const reload = async () => {
    const results = await Promise.all([getGroups(), getHangouts()]);
    setGroups(results[0].groups.map((group) => ({ id: group.id, name: group.name, memberCount: group.member_count, avatar: "🌿" })));
    setProposals(results[1]);
  };
  useEffect(() => {
    if (loading) return;
    let mounted = true;
    reload().catch((error: unknown) => {
      console.warn("Could not load groups:", error instanceof Error ? error.message : "Unknown API error");
    });
    return () => { mounted = false; };
  }, [configured, loading, session?.user.id]);
  const value = useMemo<AppStore>(() => ({
    groups,
    proposals,
    addGroup: (name, id = `local-${Date.now()}`) => setGroups((current) => [...current, { id, name, memberCount: 1, avatar: "🌱" }]),
    addProposal: (proposal) => setProposals((current) => [proposal, ...current.filter((item) => item.id !== proposal.id)]),
    replaceProposal: (proposal) => setProposals((current) => current.map((item) => item.id === proposal.id ? proposal : item)),
    reload,
  }), [groups, proposals]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore(): AppStore {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useAppStore must be used within StoreProvider");
  return value;
}
