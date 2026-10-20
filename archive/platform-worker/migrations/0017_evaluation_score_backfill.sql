UPDATE evaluation_runs
SET score = CASE
  WHEN assertion_count > 0 THEN CAST(passed_assertions AS REAL) / CAST(assertion_count AS REAL)
  ELSE 0
END
WHERE case_count = 0 AND score = 0;
