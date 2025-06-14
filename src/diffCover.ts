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
              // Print content of fileCoverInfo
              core.info(`fileCoverInfo: ${JSON.stringify(fileCoverInfo)}`);

              const misses = changedLines.filter((changedLine: string) => {
                const detail = fileCoverInfo.lines.details.find(
                  (details) => details.line === +changedLine,
                );
                // Miss if line is not found in coverage OR hit is 0
                return !detail || detail.hit === 0;
              });
              core.info(`diffCover on file=${currFile}`);
              core.info(`misses: [${misses}]`);
              core.info(
                `coverage: ${Math.round(
                  (1 - misses.length / changedLines.length) * 100,
                )}%`,
              );
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
