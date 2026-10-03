using UnrealBuildTool;

// Núcleo em C++ puro: nada aqui depende da Unreal além do IMPLEMENT_MODULE (HoopsSimCoreModule.cpp).
// Os mesmos arquivos compilam fora da engine em Plugins/HoopsSim/Tests (CMake) para os testes automatizados.
public class HoopsSimCore : ModuleRules
{
	public HoopsSimCore(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.NoPCHs;
		bUseUnity = false;
		CppStandard = CppStandardVersion.Cpp20;

		PublicDependencyModuleNames.AddRange(new string[] { "Core" });
	}
}
