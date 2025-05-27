import * as core from '@actions/core';
import {
  CoverageTypeInfo,
  DiffCoverRef,
  DiffInfo,
  EventInfo,
  FilesStatus,
} from './types';
import { execCommand } from './utils';

export const diffCover = async (
  eventInfo: EventInfo,
  filesStatus: FilesStatus,
  coverageInfo: CoverageTypeInfo,
): Promise<DiffInfo[]> => {
  if (eventInfo.showDiffcover) {
    const gitLogCommand = `git log --oneline origin/${eventInfo.baseRef}..origin/${eventInfo.headRef} -- | cut -f1 -d' '`;
    const gitLogExec = await execCommand(gitLogCommand);
    if (gitLogExec.status !== 'success') {
      throw new Error(
        `failed to retrieve git log: ${eventInfo.baseRef}..${eventInfo.headRef}. error: ${gitLogExec.message}`,
      );
    }
    const commitsSha = gitLogExec.stdout?.split('\n').filter((sha) => sha) || [];
    core.info(`commitsSha list:[${commitsSha}]`);
    const changedFiles = [
      ...filesStatus.added,
      ...filesStatus.modified,
      ...filesStatus.changed,
    ];

    return getDiff(coverageInfo, changedFiles, commitsSha, eventInfo.diffcoverRef);
  }
  return [];
};

const getDiff = async (
  coverageInfo: CoverageTypeInfo,
  changedFiles: string[],
  commitsSha: string[],
  referral: DiffCoverRef,
): Promise<DiffInfo[]> => {
  const diffInfo: DiffInfo[] = [];
  for (const fileCoverInfo of coverageInfo[referral]) {
    for (const currFile of changedFiles) {
      const changedLinesExec = await execCommand(
        `git blame ${currFile} | grep -n '${commitsSha.join('\\|')}' | cut -f1 -d:`,
      );
      if (changedLinesExec.status === 'success') {
        const changedLines =
          changedLinesExec.stdout?.split('\n').filter((line) => line) || [];
        if (changedLines.length) {
          if (fileCoverInfo.lines.details.length) {
            if (
              fileCoverInfo.file === currFile ||
              currFile.includes(fileCoverInfo.file) ||
              fileCoverInfo.file.includes(currFile)
            ) {
              // Check if all executable lines are missed (i.e., file is untested)
              const allMissed = fileCoverInfo.lines.details.every((details) => details.hit === 0);
              let misses = changedLines.filter(
                (changedLine: string) =>
                  fileCoverInfo.lines.details.find(
                    (details) => details.line === +changedLine,
                  )?.hit === 0,
              );
              let coveragePercent = 0;
              if (!allMissed && changedLines.length > 0) {
                coveragePercent = Math.round(
                  (1 - misses.length / changedLines.length) * 100,
                );
              }
              // If all lines are missed, coverage is 0%
              if (allMissed) {
                misses = changedLines;
                coveragePercent = 0;
              }
              core.info(`diffCover on file=${currFile}`);
              core.info(`misses: [${misses}]`);
              core.info(`coverage: ${coveragePercent}%`);
              diffInfo.push({
                file: currFile,
                missedLines: misses,
                changedLines: changedLines,
              });
            }
          }
        }
      } else {
        throw new Error(
          `failed to execute "git blame" on file: ${currFile}. error: ${changedLinesExec.message}`,
        );
      }
      // core.info(changedLinesExec.stdout);
    }
  }
  return diffInfo;
};
