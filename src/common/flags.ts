import type { Settings } from '../entity';

export const transformSettingFlags = ({ flags }: Pick<Settings, 'flags'>) => {
  return {
    sidebarSquadExpanded: flags?.sidebarSquadExpanded ?? true,
    sidebarCustomFeedsExpanded: flags?.sidebarCustomFeedsExpanded ?? true,
    sidebarOtherExpanded: flags?.sidebarOtherExpanded ?? true,
    sidebarResourcesExpanded: flags?.sidebarResourcesExpanded ?? true,
    sidebarBookmarksExpanded: flags?.sidebarBookmarksExpanded ?? true,
    clickbaitShieldEnabled: flags?.clickbaitShieldEnabled ?? true,
    ...flags,
  };
};
