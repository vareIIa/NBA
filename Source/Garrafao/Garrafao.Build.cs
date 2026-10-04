using UnrealBuildTool;

public class Garrafao : ModuleRules
{
	public Garrafao(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"HoopsSimCore",
		});

		// Busca do boneco animado importado (HoopsDummyRig).
		PrivateDependencyModuleNames.Add("AssetRegistry");
	}
}
