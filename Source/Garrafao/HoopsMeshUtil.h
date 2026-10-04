// Utilitários para montar a quadra/cesta "graybox" com as formas básicas da engine (/Engine/BasicShapes),
// sem depender de nenhum asset binário do projeto. A arte final substitui tudo isso depois.
#pragma once

#include "CoreMinimal.h"

class AActor;
class UMaterialInterface;
class USceneComponent;
class UStaticMesh;
class UStaticMeshComponent;

struct FHoopsBasicShapes
{
	UStaticMesh* Cube = nullptr;      // 100 x 100 x 100 cm, centrado
	UStaticMesh* Cylinder = nullptr;  // diâmetro 100 cm, altura 100 cm, eixo Z
	UStaticMesh* Sphere = nullptr;    // diâmetro 100 cm
	UMaterialInterface* BaseMaterial = nullptr; // BasicShapeMaterial (parâmetro vetorial "Color")

	// Carrega uma vez e mantém vivo (AddToRoot): são assets da própria engine.
	static const FHoopsBasicShapes& Get();
};

namespace HoopsMeshUtil
{
	// Cria um UStaticMeshComponent em runtime, anexado a Parent, com cor sólida.
	UStaticMeshComponent* AddMesh(AActor* Owner, USceneComponent* Parent, UStaticMesh* Mesh,
		const FTransform& RelativeTransform, const FLinearColor& Color, bool bCollision = false);

	// Aplica cor via material dinâmico (parâmetro "Color"). Roughness >= 0 ajusta o parâmetro "Roughness"
	// (existe no M_HoopsSolid criado pelo script de quadra realista; no BasicShapeMaterial é ignorado).
	void SetColor(UObject* Outer, UStaticMeshComponent* Component, const FLinearColor& Color, float Roughness = -1.0f);

	// Procura os materiais do projeto (Tools/Editor/setup_quadra_realista.py). Sem eles, usa os da engine.
	void RefreshProjectMaterials();
	UMaterialInterface* GetProjectMaterial(const TCHAR* AssetName); // ex.: TEXT("M_HoopsWoodFloor"); nullptr se não existir

	// Caixa fina entre dois pontos no plano local (linhas da quadra, barras). Altura Z = ZCenter.
	UStaticMeshComponent* AddStrip(AActor* Owner, USceneComponent* Parent, const FVector2D& A, const FVector2D& B,
		float Width, float Thickness, float ZCenter, const FLinearColor& Color);

	// Cilindro entre dois pontos 3D locais.
	UStaticMeshComponent* AddRod(AActor* Owner, USceneComponent* Parent, const FVector& A, const FVector& B,
		float Diameter, const FLinearColor& Color);
}
