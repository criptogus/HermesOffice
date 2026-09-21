import { describe, expect, it } from 'vitest'
import { shiftFormulaRefs, shiftIndex, shiftSpecForOp } from '../src/domain/formula-shift'
import type { StructuralOperation } from '../src/domain/workbook-dsl'

const SHEET = 'Sheet1'

function insertRows(row: number, count = 1): StructuralOperation {
  return { op: 'insert_rows', sheetId: 's1', row, count }
}

function deleteRows(row: number, count = 1): StructuralOperation {
  return { op: 'delete_rows', sheetId: 's1', row, count }
}

function insertCols(column: string, count = 1): StructuralOperation {
  return { op: 'insert_cols', sheetId: 's1', column, count }
}

function deleteCols(column: string, count = 1): StructuralOperation {
  return { op: 'delete_cols', sheetId: 's1', column, count }
}

describe('shiftSpecForOp', () => {
  it('maps row ops to a row spec with a 0-based start', () => {
    expect(shiftSpecForOp(insertRows(2, 3))).toEqual({ axis: 'row', start: 1, delta: 3 })
    expect(shiftSpecForOp(deleteRows(2, 3))).toEqual({ axis: 'row', start: 1, delta: -3 })
  })

  it('maps column ops to a column spec with a 0-based start', () => {
    expect(shiftSpecForOp(insertCols('B', 2))).toEqual({ axis: 'column', start: 1, delta: 2 })
    expect(shiftSpecForOp(deleteCols('C', 1))).toEqual({ axis: 'column', start: 2, delta: -1 })
  })

  it('returns null for sheet-level ops', () => {
    expect(shiftSpecForOp({ op: 'add_sheet', name: 'New' })).toBeNull()
    expect(shiftSpecForOp({ op: 'delete_sheet', sheetId: 's1' })).toBeNull()
  })
})

describe('shiftIndex', () => {
  it('leaves indexes before the insertion alone and shifts later ones', () => {
    expect(shiftIndex(0, { axis: 'row', start: 1, delta: 1 })).toBe(0)
    expect(shiftIndex(1, { axis: 'row', start: 1, delta: 2 })).toBe(3)
  })

  it('maps deleted indexes to null and shifts later ones up', () => {
    const spec = { axis: 'row', start: 1, delta: -2 } as const
    expect(shiftIndex(0, spec)).toBe(0)
    expect(shiftIndex(1, spec)).toBeNull()
    expect(shiftIndex(2, spec)).toBeNull()
    expect(shiftIndex(3, spec)).toBe(1)
  })
})

describe('shiftFormulaRefs on insert rows', () => {
  it('shifts refs at or below the insertion down', () => {
    const result = shiftFormulaRefs('=A1+A3', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=A1+A4')
    expect(result.changed).toBe(true)
    expect(result.hasRefError).toBe(false)
  })

  it('leaves refs above the insertion unchanged', () => {
    const result = shiftFormulaRefs('=A1', insertRows(5, 2), true, SHEET)
    expect(result.formula).toBe('=A1')
    expect(result.changed).toBe(false)
    expect(result.hasRefError).toBe(false)
  })

  it('shifts absolute refs too because dollars do not pin structural edits', () => {
    const result = shiftFormulaRefs('=$A$1+$B$2', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=$A$1+$B$3')
    expect(result.changed).toBe(true)
  })

  it('shifts multi-row inserts by the full count', () => {
    const result = shiftFormulaRefs('=A2', insertRows(2, 2), true, SHEET)
    expect(result.formula).toBe('=A4')
  })

  it('shifts ranges endpoint by endpoint', () => {
    const result = shiftFormulaRefs('=SUM($A$1:$B$2)', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=SUM($A$1:$B$3)')
  })
})

describe('shiftFormulaRefs on delete rows', () => {
  it('turns refs inside the deleted region into #REF!', () => {
    const result = shiftFormulaRefs('=A1+A2+A3', deleteRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=A1+#REF!+A2')
    expect(result.changed).toBe(true)
    expect(result.hasRefError).toBe(true)
  })

  it('shifts refs below the deletion up', () => {
    const result = shiftFormulaRefs('=A5', deleteRows(2, 2), true, SHEET)
    expect(result.formula).toBe('=A3')
    expect(result.hasRefError).toBe(false)
  })

  it('shrinks a partially deleted range instead of erroring', () => {
    const result = shiftFormulaRefs('=SUM(A1:A3)', deleteRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=SUM(A1:A2)')
    expect(result.hasRefError).toBe(false)
  })

  it('turns a fully deleted range into #REF!', () => {
    const result = shiftFormulaRefs('=SUM(A2:A3)', deleteRows(2, 2), true, SHEET)
    expect(result.formula).toBe('=SUM(#REF!)')
    expect(result.hasRefError).toBe(true)
  })

  it('does not spare absolute refs inside the deleted region', () => {
    const result = shiftFormulaRefs('=$A$2', deleteRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=#REF!')
    expect(result.hasRefError).toBe(true)
  })
})

describe('shiftFormulaRefs on columns', () => {
  it('shifts refs right on insert', () => {
    const result = shiftFormulaRefs('=A1+B1+C1', insertCols('B', 1), true, SHEET)
    expect(result.formula).toBe('=A1+C1+D1')
  })

  it('shifts absolute column refs right on insert', () => {
    const result = shiftFormulaRefs('=$A$1+$B$1', insertCols('B', 1), true, SHEET)
    expect(result.formula).toBe('=$A$1+$C$1')
  })

  it('turns deleted column refs into #REF! and shifts later ones left', () => {
    const result = shiftFormulaRefs('=A1+B1+C1', deleteCols('B', 1), true, SHEET)
    expect(result.formula).toBe('=A1+#REF!+B1')
    expect(result.hasRefError).toBe(true)
  })

  it('shrinks a partially deleted column range', () => {
    const result = shiftFormulaRefs('=SUM(A1:C1)', deleteCols('B', 1), true, SHEET)
    expect(result.formula).toBe('=SUM(A1:B1)')
    expect(result.hasRefError).toBe(false)
  })

  it('shifts whole-column spans on insert', () => {
    const result = shiftFormulaRefs('=SUM(B:B)', insertCols('B', 1), true, SHEET)
    expect(result.formula).toBe('=SUM(C:C)')
  })

  it('shifts whole-row spans on insert', () => {
    const result = shiftFormulaRefs('=SUM(2:4)', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=SUM(3:5)')
  })
})

describe('shiftFormulaRefs cross-sheet', () => {
  it('leaves bare refs alone when the formula lives on another sheet', () => {
    const result = shiftFormulaRefs('=A3', insertRows(2, 1), false, SHEET)
    expect(result.formula).toBe('=A3')
    expect(result.changed).toBe(false)
  })

  it('rewrites a matching sheet prefix even when the formula lives elsewhere', () => {
    const result = shiftFormulaRefs('=Sheet1!A3', insertRows(2, 1), false, SHEET)
    expect(result.formula).toBe('=Sheet1!A4')
    expect(result.changed).toBe(true)
  })

  it('leaves a non-matching sheet prefix alone', () => {
    const result = shiftFormulaRefs('=Other!A3', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=Other!A3')
    expect(result.changed).toBe(false)
  })

  it('rewrites quoted sheet names with spaces', () => {
    const result = shiftFormulaRefs("='My Sheet'!A3", insertRows(2, 1), false, 'My Sheet')
    expect(result.formula).toBe("='My Sheet'!A4")
  })

  it('rewrites quoted names with an escaped single quote', () => {
    const result = shiftFormulaRefs("='Bob''s'!A3", insertRows(2, 1), false, "Bob's")
    expect(result.formula).toBe("='Bob''s'!A4")
  })

  it('rewrites sheet-qualified ranges on the target sheet only', () => {
    const kept = shiftFormulaRefs('=SUM(Other!A1:A3)', deleteRows(2, 1), true, SHEET)
    expect(kept.formula).toBe('=SUM(Other!A1:A3)')
    const moved = shiftFormulaRefs('=SUM(Sheet1!A1:A3)', deleteRows(2, 1), false, SHEET)
    expect(moved.formula).toBe('=SUM(Sheet1!A1:A2)')
  })
})

describe('shiftFormulaRefs literals and names', () => {
  it('skips refs inside quoted string literals', () => {
    const result = shiftFormulaRefs('="A3"+A3', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('="A3"+A4')
  })

  it('leaves function names such as LOG10 alone', () => {
    const result = shiftFormulaRefs('=LOG10(A1)+A3', insertRows(2, 1), true, SHEET)
    expect(result.formula).toBe('=LOG10(A1)+A4')
  })

  it('returns the input unchanged for sheet-level ops', () => {
    const result = shiftFormulaRefs('=A1', { op: 'add_sheet', name: 'New' }, true, SHEET)
    expect(result).toEqual({ formula: '=A1', changed: false, hasRefError: false })
  })
})
