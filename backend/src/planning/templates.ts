/**
 * Workflow templates: stage structure only. Times, workstations and yields are
 * deliberately left empty — the WMS holds no productivity standards, so the
 * planner must enter validated values (or mark them as estimates).
 */
export interface TemplateStage {
  key: string;
  name: string;
  dependsOn: string[];
  skill: string;
  isQualityGate: boolean;
  completionCriteria: string;
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  projectTypes: string[];
  stages: TemplateStage[];
}

const s = (
  key: string,
  name: string,
  dependsOn: string[],
  skill: string,
  completionCriteria: string,
  isQualityGate = false,
): TemplateStage => ({
  key,
  name,
  dependsOn,
  skill,
  isQualityGate,
  completionCriteria,
});

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'REPAIR',
    name: 'Repair',
    projectTypes: ['REPAIR'],
    stages: [
      s('RECV', 'Receiving', [], 'Warehouse', 'Unit received and labelled'),
      s(
        'INSP',
        'Inspection',
        ['RECV'],
        'Technician',
        'Fault diagnosed and recorded',
      ),
      s('REPAIR', 'Repair', ['INSP'], 'Technician', 'Repair completed'),
      s(
        'QA',
        'QA / Test',
        ['REPAIR'],
        'QA',
        'Unit passes functional test',
        true,
      ),
      s('PACK', 'Packing', ['QA'], 'Warehouse', 'Unit packed and labelled'),
      s('DISP', 'Dispatch', ['PACK'], 'Warehouse', 'Handed over to carrier'),
    ],
  },
  {
    key: 'REFURBISHMENT',
    name: 'Refurbishment / rework',
    projectTypes: ['REFURBISHMENT'],
    stages: [
      s('RECV', 'Receiving', [], 'Warehouse', 'Unit received'),
      s('GRADE', 'Grading', ['RECV'], 'Technician', 'Grade assigned'),
      s('CLEAN', 'Cleaning', ['GRADE'], 'Operator', 'Cosmetic standard met'),
      s('REWORK', 'Rework', ['GRADE'], 'Technician', 'Rework completed'),
      s(
        'QA',
        'QA / Test',
        ['CLEAN', 'REWORK'],
        'QA',
        'Passes refurbishment test',
        true,
      ),
      s('PACK', 'Packing', ['QA'], 'Warehouse', 'Packed'),
    ],
  },
  {
    key: 'INBOUND',
    name: 'Receiving → Inspection → Putaway',
    projectTypes: ['INBOUND'],
    stages: [
      s(
        'RECV',
        'Receiving',
        [],
        'Warehouse',
        'Goods received against document',
      ),
      s(
        'INSP',
        'Inspection',
        ['RECV'],
        'QA',
        'Inspection outcome recorded',
        true,
      ),
      s('PUT', 'Putaway', ['INSP'], 'Warehouse', 'Stored in a location'),
    ],
  },
  {
    key: 'OUTBOUND',
    name: 'Picking → Packing → Shipping',
    projectTypes: ['OUTBOUND'],
    stages: [
      s('PICK', 'Picking', [], 'Warehouse', 'Picked and scanned'),
      s('PACK', 'Packing', ['PICK'], 'Warehouse', 'Packed and checked', true),
      s('SHIP', 'Shipping', ['PACK'], 'Warehouse', 'Handed over'),
    ],
  },
  {
    key: 'CUSTOM',
    name: 'Custom (start empty)',
    projectTypes: ['CUSTOM'],
    stages: [],
  },
];

export const PROJECT_TYPES = [
  'REPAIR',
  'REFURBISHMENT',
  'INBOUND',
  'OUTBOUND',
  'CUSTOM',
] as const;

/** A scenario stage built from a template stage — business values left blank. */
export function templateStageInput(t: TemplateStage) {
  return {
    ...t,
    timeBasis: 'MINUTES_PER_UNIT',
    stdMinutesPerUnit: null,
    unitsPerPersonShift: null,
    productivitySource: 'ESTIMATE',
    setupMinutes: 0,
    changeovers: 0,
    workstations: null,
    operatorsPerStation: 1,
    yieldPct: 100,
    reworkPct: 0,
    bufferPct: 0,
    benchAreaM2: null,
  };
}
