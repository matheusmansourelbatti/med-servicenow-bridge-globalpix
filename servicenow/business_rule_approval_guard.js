/*
 * Business Rule: "MED - approval guard"
 *   Table:     MED Case [u_med_case]
 *   When:      before   Update: checked   Order: 100
 *   Advanced:  checked (paste this into the Script field)
 *
 * Runs before the "MED - Send approved response" flow sees the change.
 * Only users with the med_approver role can approve, a justification is required,
 * and the approver is recorded on the case.
 */
(function executeRule(current, previous) {
  if (!current.u_med_status.changesTo('approved')) return;

  if (!gs.hasRole('med_approver')) {
    gs.addErrorMessage('Only MED approvers can approve a response.');
    current.setAbortAction(true);
    return;
  }

  if (!current.u_justification.toString().trim()) {
    gs.addErrorMessage('Write the justification before approving this MED response.');
    current.setAbortAction(true);
    return;
  }

  current.u_approved_by = gs.getUserID();
  current.work_notes = 'Response approved by ' + gs.getUserDisplayName() + '.';
})(current, previous);
