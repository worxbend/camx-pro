"""Engineering centerline views of the prescribed pan cable paths, not product renders."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from cad.cables import specifications,points


def main():
    out=Path('exports/drawings');out.mkdir(parents=True,exist_ok=True)
    fig,axs=plt.subplots(1,3,figsize=(15,5),layout='constrained')
    for ax,angle in zip(axs,[-160,0,160]):
        for name,c in specifications().items():
            path=points(c,angle)
            ax.plot(path[:,0],path[:,1],lw=2,label=f'{name}: Z{c["z"]}, Rbend{c["b"]}')
        ax.add_patch(plt.Circle((0,0),25,fill=False,color='#777',lw=1))
        ax.set(xlim=(-82,82),ylim=(-82,82),aspect='equal',title=f'Pan {angle}°',xlabel='X / mm',ylabel='Y / mm')
        ax.grid(alpha=.15)
    axs[0].legend(fontsize=8)
    fig.suptitle('P3 ideal rolling cable paths — separate vertical layers; physical behavior unqualified')
    for extension in ['png','svg','pdf']:fig.savefig(out/f'cable-routing.{extension}',dpi=200)
    plt.close(fig)

if __name__=='__main__':main()
