using UnrealBuildTool;
using System.Collections.Generic;

public class GarrafaoEditorTarget : TargetRules
{
	public GarrafaoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Garrafao");
	}
}
