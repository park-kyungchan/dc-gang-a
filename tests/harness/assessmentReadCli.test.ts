import { expect, it } from 'bun:test';
import { parseAssessmentReadArguments } from '../../harness/assessment_read';

it('requires explicit score-view admission and a profile-private script destination', () => {
  const args = ['--har', '/private/capture.har', '--teacher', 'Invented Teacher', '--admit-score-view',
    '--output', '/invented/profile/cache/scratch/read.js'];
  expect(parseAssessmentReadArguments(args, '/invented/profile')).toEqual({
    captures: ['/private/capture.har'], teacherLabel: 'Invented Teacher', output: '/invented/profile/cache/scratch/read.js', admission: true });
});

it('rejects missing admission, foreign destinations and unsupported flags', () => {
  const base = ['--har', '/private/capture.har', '--teacher', 'Invented Teacher'];
  expect(() => parseAssessmentReadArguments([...base, '--output', '/invented/profile/cache/scratch/read.js'], '/invented/profile'))
    .toThrow('score_view_admission_required');
  expect(() => parseAssessmentReadArguments([...base, '--admit-score-view', '--output', '/other/profile/read.js'], '/invented/profile'))
    .toThrow('profile_scratch_destination_required');
  expect(() => parseAssessmentReadArguments(['--cookie', 'synthetic'], '/invented/profile')).toThrow('unsupported_flag');
  expect(() => parseAssessmentReadArguments(base, undefined)).toThrow('active_profile_required');
});

it('does not accept a credential file or unbounded capture batch', () => {
  expect(() => parseAssessmentReadArguments(['--har', '/private/.env'], '/invented/profile')).toThrow('har_file_required');
  expect(() => parseAssessmentReadArguments(['--har', '/a.har', '--har', '/b.har', '--har', '/c.har', '--teacher', 'Invented Teacher',
    '--admit-score-view', '--output', '/invented/profile/cache/scratch/read.js'], '/invented/profile')).toThrow('invalid_preparation_scope');
});
