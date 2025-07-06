import { useState, useEffect } from "react";
import { api } from "../api";

export function useMandatory() {
  const [all, setAll] = useState<string[]>([]);
  const [orderMap, setOrderMap] = useState<Record<string, number>>({});
  const [required, setReq] = useState<Set<string>>(new Set());
  const [conditional, setCond] = useState<Set<string>>(new Set());
  const [parentReq, setparentReq] = useState<Set<string>>(new Set());
  const [parentOpt, setparentOpt] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.get("/spec").then((r) => {
      setAll(r.data.tagList);
      setReq(new Set(r.data.required ?? r.data.mandatory ?? []));
      setCond(new Set(r.data.conditional ?? []));
      setOrderMap(r.data.orderMap);
      setparentReq(new Set(r.data.parentReq));
      setparentOpt(new Set(r.data.parentOpt));
    });
  }, []);

  return { all, orderMap, required, conditional, parentReq, parentOpt };
}
