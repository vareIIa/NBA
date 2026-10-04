using UnrealBuildTool;
using System.Collections.Generic;

public class GarrafaoTarget : TargetRules
{
	public GarrafaoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Garrafao");
	}
}
