export type ChemistAssignment = { id: string; role: string; active: boolean } | null;

export function isActiveShiftChemist(chemist: ChemistAssignment): chemist is { id: string; role: 'CHEMIST'; active: true } {
  return !!chemist && chemist.role === 'CHEMIST' && chemist.active;
}

export function canAcknowledgeAssignedShiftChemist(
  actor: { id: string; role: string },
  assignedChemist: ChemistAssignment
): boolean {
  return actor.role === 'CHEMIST' && isActiveShiftChemist(assignedChemist) && actor.id === assignedChemist.id;
}

export function canViewShiftRecordAsChemist(actorId: string, status: string, assignedChemistId: string | null): boolean {
  if (status === 'SUBMITTED') return assignedChemistId === actorId;
  return status === 'APPROVED' || status === 'LOCKED';
}
